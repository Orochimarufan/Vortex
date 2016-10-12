import { IState } from '../../../types/IState';
import { ISupportedTools } from '../../../types/ISupportedTools';

export interface IDiscoveryResult {
  path: string;
  modPath: string;
}

export interface IToolDiscoveryResult {
  path: string;
  toolName: string;
}

/**
 * state of the (lengthy) gamemode discovery
 * 
 * @export
 * @interface IDiscoveryState
 */
export interface IDiscoveryState {
  running: boolean;
  progress: number;
  directory: string;
}

export interface IGameStored {
  id: string;
  name: string;
  logo: string;
  pluginPath?: string;
  requiredFiles: string[];
  supportedTools: () => ISupportedTools[];
}

/**
 * gamemode-related application settings
 * 
 * @export
 * @interface ISettings
 */
export interface IGameModeSettings {
  current: string;
  discovered: { [id: string]: IDiscoveryResult };
  discoveredTool: { [id: string]: IDiscoveryResult };
  searchPaths: string[];
}

export interface IStateEx extends IState {
  session: {
    gameMode: {
      known: IGameStored[]
    },
    discovery: IDiscoveryState
  };
  settings: {
    gameMode: IGameModeSettings,
  };

}
