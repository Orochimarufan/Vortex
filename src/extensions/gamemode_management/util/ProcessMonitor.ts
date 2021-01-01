import { setToolPid, setToolStopped } from '../../../actions';
import { makeExeId } from '../../../reducers/session';
import { IDiscoveredTool } from '../../../types/IDiscoveredTool';
import { IExtensionApi } from '../../../types/IExtensionContext';
import { IState } from '../../../types/IState';
import { log } from '../../../util/log';
import { currentGame, currentGameDiscovery } from '../../../util/selectors';
import { getSafe } from '../../../util/storeHelper';
import { setdefault } from '../../../util/util';

import { BrowserWindow, remote } from 'electron';
import * as path from 'path';
import * as Redux from 'redux';
import * as winapi from 'winapi-bindings';
import * as fs from 'fs';


// ---- Platform Abstraction ----
interface IProcessInfo {
  // Should be compatible with winapi.ProcessEntry
  processID: number;
  parentProcessID: number;
  exeFile: string;
}

interface IProcessMonitorImpl {
  getProcessList(): IProcessInfo[];
}

class ProcessMonitorImplWin32 implements IProcessMonitorImpl{
  getProcessList = winapi.GetProcessList;
}

class ProcessMonitorImplProcfs implements IProcessMonitorImpl {
  private proc_path: string = "/proc";

  private isOnlyDigits(s: string): boolean {
    const zero = '0'.codePointAt(0);
    const nine = '9'.codePointAt(0);
    for (let i=0; i<s.length; i++) {
      const c = s.codePointAt(i);
      if (c < zero || c > nine)
        return false;
    }
    return true;
  }

  getProcessInfo(pid: number|string): IProcessInfo {
    const pidStr = pid.toString();
    let stat: string;
    try {
      stat = fs.readFileSync(path.join(this.proc_path, pidStr, "stat"), "utf-8");
    } catch(err) {
      if (err.code === "ENOENT") {
        // Process doesn't exist
        return null;
      } else {
        throw err;
      }
    }
    // Parse proc/pid/stat. See `man 5 proc`
    const exeFile_start = stat.indexOf('(') + 1;
    const exeFile_end = stat.lastIndexOf(')');
    const ppid_start = exeFile_end + 4;
    return {
      processID: typeof pid === 'number'? pid : Number.parseInt(pidStr),
      parentProcessID: Number.parseInt(stat.slice(ppid_start, stat.indexOf(' ', ppid_start))),
      exeFile: stat.slice(exeFile_start, exeFile_end),
    };
  }

  getProcessList(): IProcessInfo[] {
    // Read /proc entries
    let proc_entries: string[];
    try {
      proc_entries = fs.readdirSync(this.proc_path);
    } catch (err) {
      throw err;
    }
    return proc_entries.filter(this.isOnlyDigits.bind(this)).map(this.getProcessInfo.bind(this));
  }
}

// ---- Game process monitoring ----
class ProcessMonitor {
  private mTimer: NodeJS.Timer;
  private mStore: Redux.Store<IState>;
  private mWindow: BrowserWindow;
  private mActive: boolean = false;
  private mImpl: IProcessMonitorImpl;

  constructor(api: IExtensionApi) {
    this.mStore = api.store;

    if (process.platform === 'win32') {
      this.mImpl = new ProcessMonitorImplWin32();
    } else if (process.platform === 'linux') {
      this.mImpl = new ProcessMonitorImplProcfs();
    }
  }

  public start(): void {
    if (this.mImpl === undefined) {
      // Not supported
      return;
    }
    if (this.mActive) {
      // already running
      return;
    }

    if (this.mTimer !== undefined) {
      // ensure we don't have multiple timers running in parallel
      clearTimeout(this.mTimer);
    }

    if (remote !== undefined) {
      this.mWindow = remote.getCurrentWindow();
    }

    log('debug', 'start process monitor');
    this.mTimer = setTimeout(() => this.check(), 2000);
    this.mActive = true;
  }

  public end(): void {
    if (this.mTimer === undefined) {
      // not running
      return;
    }
    clearTimeout(this.mTimer);
    this.mTimer = undefined;
    this.mActive = false;
    log('debug', 'stop process monitor');
  }

  private check(): void {
    if (!this.mActive) {
      return;
    }
    // skip check and tick slower when in background, for performance reasons
    if ((this.mWindow === undefined) || this.mWindow.isFocused()) {
      this.doCheck();
      if (this.mActive) {
        this.mTimer = setTimeout(() => this.check(), 2000);
      }
    } else {
      this.mTimer = setTimeout(() => this.check(), 5000);
    }
  }

  private doCheck(): void {
    const processes = this.mImpl.getProcessList();

    const byPid: { [pid: number]: IProcessInfo } = processes.reduce((prev, proc) => {
      prev[proc.processID] = proc;
      return prev;
    }, {});

    const byName: { [exeId: string]: IProcessInfo[] } =
      processes.reduce((prev: { [exeId: string]: IProcessInfo[] }, entry) => {
        setdefault(prev, entry.exeFile.toLowerCase(), []).push(entry);
        return prev;
      }, {});
    const state = this.mStore.getState();

    const vortexPid = process.pid;

    const isChildProcess = (proc: IProcessInfo, visited: Set<number>): boolean => {
      if ((proc === undefined) || (proc.parentProcessID === 0)) {
        return false;
      } else if (visited.has(proc.parentProcessID)) {
        // a loop in process hierarchy? Apparently that is possible, see #6508
        return false;
      } else {
        visited.add(proc.parentProcessID);
        return (proc.parentProcessID === vortexPid)
            || isChildProcess(byPid[proc.parentProcessID], visited);
      }
    };

    const game = currentGame(state);
    const gameDiscovery = currentGameDiscovery(state);
    const gameExe = getSafe(gameDiscovery, ['executable'], undefined)
                 || getSafe(game, ['executable'], undefined);
    const gamePath = getSafe(gameDiscovery, ['path'], undefined);
    if ((gameExe === undefined) || (gamePath === undefined)) {
      // How in the world can we manage to get the executable for the game
      //  but not the path from the discovery object ?
      // https://github.com/Nexus-Mods/Vortex/issues/4656
      return;
    }

    const update = (exePath: string, exclusive: boolean, considerDetached: boolean) => {
      const exeId = makeExeId(exePath);
      const knownRunning = state.session.base.toolsRunning[exeId];
      const exeRunning = byName[exeId];

      if (exeRunning === undefined) {
        // nothing with a matching exe name is running
        if (knownRunning !== undefined) {
          this.mStore.dispatch(setToolStopped(exePath));
        }
        return;
      }

      if ((knownRunning !== undefined) && (byPid[knownRunning.pid] !== undefined)) {
        // we already know this tool is running and the corresponding process is still active
        return;
      }

      // at this point the tool is running (or an exe with the same name is)
      // and we don't know about it

      const candidates = considerDetached
        ? exeRunning
        : exeRunning.filter(proc => isChildProcess(proc, new Set()));
      const match = candidates.find(exe => {
        const modules = winapi.GetModuleList(exe.processID);

        return (modules.length > 0)
            && (modules[0].exePath.toLowerCase() === exePath.toLowerCase());
      });

      if (match !== undefined) {
        this.mStore.dispatch(setToolPid(exePath, match.processID, exclusive));
      } else if (knownRunning !== undefined) {
        this.mStore.dispatch(setToolStopped(exePath));
      }
    };

    const gameExePath = path.join(gamePath, gameExe);
    update(gameExePath, true, true);

    const discoveredTools: { [toolId: string]: IDiscoveredTool } =
      getSafe(state, ['settings', 'gameMode', 'discovered', game.id, 'tools'], {});

    Object.keys(discoveredTools).forEach(toolId => {
      if (discoveredTools[toolId].path === undefined) {
        return;
      }
      update(discoveredTools[toolId].path, discoveredTools[toolId].exclusive || false, false);
    });
  }
}

export default ProcessMonitor;
