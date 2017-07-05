import { setMultiUser } from '../../actions/user';
import { IState } from '../../types/IState';
import { ComponentEx, connect, translate } from '../../util/ComponentEx';
import { spawnSelf } from '../../util/util';
import More from '../../views/More';

import getText from './texts';

import { remote } from 'electron';
import * as React from 'react';
import { Alert, Button, ControlLabel, FormControl, FormGroup, HelpBlock } from 'react-bootstrap';
import * as Redux from 'redux';

interface IConnectedProps {
  multiUser: boolean;
}

interface IActionProps {
  onSetMultiUser: (multiUser: boolean) => void;
}

type IProps = IConnectedProps & IActionProps;

interface IComponentState {
  oldMultiUser: boolean;
}

class SettingsVortex extends ComponentEx<IProps, IComponentState> {
  constructor(props: IProps) {
    super(props);

    this.initState({
      oldMultiUser: props.multiUser,
    });
  }

  public render(): JSX.Element {
    const {t, multiUser} = this.props;
    const {oldMultiUser} = this.state;

    const restartNoti = (multiUser === oldMultiUser) ? null : (
      <HelpBlock>
        <Alert>
          {t('You need to restart Vortex to activate this change')}
          <Button onClick={this.restart} style={{ marginLeft: '1em' }}>{t('Restart now')}</Button>
        </Alert>
      </HelpBlock>
    );

    return (
      <form>
        <FormGroup controlId='muMode'>
          <FormControl.Static componentClass='div'>
            {t('Multi-User Mode')}
            <More id='more-multi-user' name={t('Multi-User Mode')}>
              {getText('multi-user', t)}
            </More>
          </FormControl.Static>
          <FormControl
            componentClass='select'
            onChange={this.selectMode}
            value={multiUser ? 'on' : 'off'}
          >
            <option value='on'>{t('Shared')}</option>
            <option value='off'>{t('Per-User')}</option>
          </FormControl>
          {restartNoti}
        </FormGroup>
      </form>
    );
  }

  private selectMode = (evt) => {
    const { onSetMultiUser } = this.props;
    onSetMultiUser(evt.currentTarget.value === 'on');
  }

  private restart = () => {
    spawnSelf(['--wait']);
    remote.app.exit(0);
  }
}

function mapStateToProps(state: IState): IConnectedProps {
  return {
    multiUser: state.user.multiUser,
  };
}

function mapDispatchToProps(dispatch: Redux.Dispatch<any>): IActionProps {
  return {
    onSetMultiUser: (multiUser: boolean) => dispatch(setMultiUser(multiUser)),
  };
}

export default translate(['common'], { wait: false })(
  connect(mapStateToProps, mapDispatchToProps)(
    SettingsVortex)) as React.ComponentClass<{}>;
