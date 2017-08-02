import { setDialogVisible, setOpenMainPage, setOverlayOpen } from '../actions/session';
import { setTabsMinimized } from '../actions/window';

import { IActionDefinition } from '../types/IActionDefinition';
import { IComponentContext } from '../types/IComponentContext';
import { IExtensionApi, IMainPageOptions } from '../types/IExtensionContext';
import { II18NProps } from '../types/II18NProps';
import { IMainPage } from '../types/IMainPage';
import { IState } from '../types/IState';
import { connect, extend } from '../util/ComponentEx';
import { getSafe } from '../util/storeHelper';
import DeveloperType from './Developer';
import Dialog from './Dialog';
import DialogContainer from './DialogContainer';
import DNDContainer from './DNDContainer';
import GlobalOverlay from './GlobalOverlay';
import Icon from './Icon';
import IconBar from './IconBar';
import MainFooter from './MainFooter';
import MainOverlay from './MainOverlay';
import MainPageContainer from './MainPageContainer';
import NotificationButton from './NotificationButton';
import QuickLauncher from './QuickLauncher';
import Settings from './Settings';
import { Button, IconButton, NavItem } from './TooltipControls';

import * as I18next from 'i18next';
import * as update from 'immutability-helper';
import * as _ from 'lodash';
import * as PropTypes from 'prop-types';
import * as React from 'react';
import { Badge, ControlLabel, FormGroup, Modal, Nav } from 'react-bootstrap';
import { Fixed, Flex, Layout } from 'react-layout-pane';
import * as Redux from 'redux';

interface IPageButtonProps {
  t: I18next.TranslationFunction;
  page: IMainPage;
}

class PageButton extends React.Component<IPageButtonProps, {}> {
  public componentWillMount() {
    const { page } = this.props;
    if (page.badge) {
      page.badge.attach(this);
    }
    if (page.activity) {
      page.activity.attach(this);
    }
  }

  public componentWillUnmount() {
    const { page } = this.props;
    if (page.badge) {
      page.badge.detach(this);
    }
    if (page.activity) {
      page.activity.detach(this);
    }
  }

  public render() {
    const { t, page } = this.props;
    return (
      <div>
        <Icon name={page.icon} />
        <span className='menu-label'>
          {t(page.title)}
        </span>
        {this.renderBadge()}
        {this.renderActivity()}
      </div>
    );
  }

  private renderBadge() {
    const { page } = this.props;

    if (page.badge === undefined) {
      return null;
    }

    return <Badge>{page.badge.calculate()}</Badge>;
  }

  private renderActivity() {
    const { page } = this.props;

    if ((page.activity === undefined) || !page.activity.calculate()) {
      return null;
    }

    return <Icon name='spinner' pulse />;
  }
}

export interface IBaseProps {
  t: I18next.TranslationFunction;
  className: string;
  api: IExtensionApi;
}

export interface IExtendedProps {
  objects: IMainPage[];
}

export interface IMainWindowState {
  showLayer: string;
  loadedPages: string[];
  hidpi: boolean;
}

export interface IConnectedProps {
  tabsMinimized: boolean;
  overlayOpen: boolean;
  visibleDialog: string;
  mainPage: string;
  secondaryPage: string;
  activeProfileId: string;
  nextProfileId: string;
}

export interface IActionProps {
  onSetTabsMinimized: (minimized: boolean) => void;
  onSetOverlayOpen: (open: boolean) => void;
  onSetOpenMainPage: (page: string, secondary: boolean) => void;
  onHideDialog: () => void;
}

export type IProps = IBaseProps & IConnectedProps & IExtendedProps & IActionProps & II18NProps;

export class MainWindow extends React.Component<IProps, IMainWindowState> {
  // tslint:disable-next-line:no-unused-variable
  public static childContextTypes: React.ValidationMap<any> = {
    api: PropTypes.object.isRequired,
    menuLayer: PropTypes.object,
  };

  private applicationButtons: IActionDefinition[];

  private settingsPage: IMainPage;
  private nextState: IMainWindowState;

  private pageHeader: JSX.Element = null;
  private pageOverlay: JSX.Element = null;
  private menuLayer: JSX.Element = null;

  private overlayRef: HTMLElement = null;
  private headerRef: HTMLElement = null;

  constructor(props: IProps) {
    super(props);

    this.state = this.nextState = {
      showLayer: '',
      loadedPages: [],
      hidpi: false,
    };

    this.settingsPage = {
      title: 'Settings',
      group: 'global',
      component: Settings,
      icon: 'sliders',
      propsFunc: () => undefined,
      visible: () => true,
    };

    this.applicationButtons = [];
  }

  public getChildContext(): IComponentContext {
    const { api } = this.props;
    return { api, menuLayer: this.menuLayer };
  }

  public componentWillMount() {
    if (this.props.objects.length > 0) {
      this.setMainPage(this.props.objects[0].title, false);
    }

    this.props.api.events.on('show-main-page', title => {
      this.setMainPage(title, false);
    });

    this.props.api.events.on('show-modal', id => {
      this.updateState({
        showLayer: { $set: id },
      });
    });

    this.updateSize();
  }

  public componentDidMount() {
    window.addEventListener('resize', this.updateSize);
  }

  public componentWillUnmount() {
    window.removeEventListener('resize', this.updateSize);
  }

  public shouldComponentUpdate(nextProps: IProps, nextState: IMainWindowState) {
    return this.props.visibleDialog !== nextProps.visibleDialog
      || this.props.overlayOpen !== nextProps.overlayOpen
      || this.props.tabsMinimized !== nextProps.tabsMinimized
      || this.props.mainPage !== nextProps.mainPage
      || this.props.secondaryPage !== nextProps.secondaryPage
      || this.props.activeProfileId !== nextProps.activeProfileId
      || this.props.nextProfileId !== nextProps.nextProfileId
      || this.state.showLayer !== nextState.showLayer
      || this.state.hidpi !== nextState.hidpi
      ;
  }

  public render(): JSX.Element {
    const { activeProfileId, onHideDialog, nextProfileId, visibleDialog } = this.props;
    const { hidpi } = this.state;

    if (activeProfileId !== nextProfileId) {
      return this.renderWait();
    }

    return (
      <div className={hidpi ? 'hidpi' : 'lodpi'}>
        <div id='menu-layer' ref={this.setMenuLayer} />
        <Layout type='column'>
          {this.renderToolbar()}
          {this.renderBody()}
          {this.renderFooter()}
        </Layout>
        <Dialog />
        {this.renderDeveloperModal()}
        <DialogContainer visibleDialog={visibleDialog} onHideDialog={onHideDialog} />
      </div>
    );
  }

  private renderWait() {
    const style = {
      margin: 'auto',
      width: '64px',
      height: '100%',
      display: 'block',
    };
    return <Icon name='spinner' pulse style={style} />;
  }

  private updateState(spec: any) {
    this.nextState = update(this.nextState, spec);
    this.setState(this.nextState);
  }

  private renderToolbar() {
    const { t } = this.props;
    return (
      <Fixed id='main-toolbar'>
        <QuickLauncher t={t} />
        <NotificationButton id='notification-button' />
        <div className='mainpage-header-container' ref={this.setHeaderRef} />
        <IconBar
          className='application-icons'
          group='application-icons'
          staticElements={this.applicationButtons}
        />
        <IconButton
          id='btn-open-flyout'
          icon='menu-dots'
          rotate={90}
          tooltip={t('Functions')}
          onClick={this.toggleOverlay}
          className='pull-right'
        />
      </Fixed>
    );
  }

  private updateSize = () => {
    this.updateState({
      hidpi: { $set: screen.width > 1920 },
    });
  }

  private renderBody() {
    const { t, mainPage, objects, overlayOpen, tabsMinimized } = this.props;

    const globalPages = objects.filter(page => page.group === 'global');
    const perGamePages = objects.filter(page => page.group === 'per-game');
    const supportPages = objects.filter(page => page.group === 'support');

    const sbClass = tabsMinimized ? 'sidebar-compact' : 'sidebar-expanded';

    const globalOverlay = <GlobalOverlay t={t} />;

    const pages = objects.map(obj => this.renderPage(obj, globalOverlay));
    pages.push(this.renderPage(this.settingsPage, globalOverlay));

    return (
      <Flex>
        <Layout type='row' style={{ overflowX: 'hidden', overflowY: 'hidden' }}>
          <Fixed id='main-nav-sidebar' className={sbClass}>
            <div id='main-nav-container'>
              <Nav
                bsStyle='pills'
                stacked
                activeKey={mainPage}
                style={{ flexGrow: 1 }}
              >
                {globalPages.map(this.renderPageButton)}
                {this.renderPageButton(this.settingsPage)}
              </Nav>
              <Nav
                bsStyle='pills'
                stacked
                activeKey={mainPage}
                style={{ flexGrow: 1 }}
              >
                {perGamePages.map(this.renderPageButton)}
              </Nav>
              <Nav
                bsStyle='pills'
                stacked
                activeKey={mainPage}
                style={{ flexGrow: 1 }}
              >
                {supportPages.map(this.renderPageButton)}
              </Nav>
            </div>
            <Button
              tooltip={tabsMinimized ? t('Restore') : t('Minimize')}
              id='btn-minimize-menu'
              onClick={this.toggleMenu}
              className='btn-menu-minimize'
            >
              <Icon name={tabsMinimized ? 'angle-double-right' : 'angle-double-left'} />
            </Button>
          </Fixed>
          <Flex id='main-window-pane'>
            <DNDContainer style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {pages}
            </DNDContainer>
            <MainOverlay
              open={overlayOpen}
              overlayRef={this.setOverlayRef}
            />
          </Flex>
        </Layout>
      </Flex>
    );
  }

  private setOverlayRef = ref => {
    this.overlayRef = ref;
  }

  private setHeaderRef = ref => {
    this.headerRef = ref;
  }

  private renderFooter() {
    return (
      <Fixed>
        <MainFooter />
      </Fixed>
    );
  }

  private renderPageButton = (page: IMainPage) => {
    const { t, secondaryPage } = this.props;
    return !page.visible() ? null : (
      <NavItem
        id={page.title}
        className={secondaryPage === page.title ? 'secondary' : undefined}
        key={page.title}
        eventKey={page.title}
        tooltip={t(page.title)}
        placement='right'
        onClick={this.handleClickPage}
      >
        <PageButton
          t={this.props.t}
          page={page}
        />
      </NavItem>
    );
  }

  private renderPage(page: IMainPage, globalOverlay: JSX.Element) {
    const { mainPage, secondaryPage } = this.props;
    const { loadedPages } = this.state;

    if (loadedPages.indexOf(page.title) === -1) {
      // don't render pages that have never been opened
      return null;
    }

    const active = [mainPage, secondaryPage].indexOf(page.title) !== -1;

    return (
      <MainPageContainer
        key={page.title}
        page={page}
        active={active}
        secondary={secondaryPage === page.title}
        overlayPortal={this.overlayRef}
        headerPortal={this.headerRef}
      />
    );
  }

  private setMenuLayer = (ref) => {
    this.menuLayer = ref;
  }

  private toggleOverlay = () => {
    this.props.onSetOverlayOpen(!this.props.overlayOpen);
  }

  private handleClickPage = (evt: React.MouseEvent<any>) => {
    this.setMainPage(evt.currentTarget.id, evt.ctrlKey);
  }

  private hideLayer = () => this.showLayerImpl('');

  private showLayerImpl(layer: string): void {
    if (this.state.showLayer !== '') {
      this.props.api.events.emit('hide-modal', this.state.showLayer);
    }
    this.updateState({ showLayer: { $set: layer } });
  }

  private setMainPage = (title: string, secondary: boolean) => {
    if (this.props.mainPage !== title) {
      this.props.onSetOverlayOpen(false);
    }
    // set the page as "loaded", set it as the shown page next frame.
    // this way it gets rendered as hidden once and can then "transition"
    // to visible
    this.updateState({
      loadedPages: { $push: [title] },
    });
    setImmediate(() => {
      if (secondary && (title === this.props.secondaryPage)) {
        this.props.onSetOpenMainPage('', secondary);
      } else {
        this.props.onSetOpenMainPage(title, secondary);
      }
    });
  }

  private toggleMenu = () => {
    this.props.onSetTabsMinimized(!this.props.tabsMinimized);
  }

  private renderDeveloperModal() {
    if (process.env.NODE_ENV !== 'development') {
      return null;
    } else {
      const Developer: typeof DeveloperType = require('./Developer').default;
      return Developer === undefined ? null : (
        <Modal
          show={this.state.showLayer === 'developer'}
          onHide={this.hideLayer}
        >
          <Modal.Header>
            <Modal.Title>Developer</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Developer />
          </Modal.Body>
        </Modal>
      );
    }
  }
}

function trueFunc() {
  return true;
}

function emptyFunc() {
  return {};
}

function mapStateToProps(state: IState): IConnectedProps {
  return {
    tabsMinimized: getSafe(state, ['settings', 'window', 'tabsMinimized'], false),
    overlayOpen: state.session.base.overlayOpen,
    visibleDialog: state.session.base.visibleDialog,
    mainPage: state.session.base.mainPage,
    secondaryPage: state.session.base.secondaryPage,
    activeProfileId: state.settings.profiles.activeProfileId,
    nextProfileId: state.settings.profiles.nextProfileId,
  };
}

function mapDispatchToProps(dispatch: Redux.Dispatch<any>): IActionProps {
  return {
    onSetTabsMinimized: (minimized: boolean) => dispatch(setTabsMinimized(minimized)),
    onSetOverlayOpen: (open: boolean) => dispatch(setOverlayOpen(open)),
    onSetOpenMainPage:
      (page: string, secondary: boolean) => dispatch(setOpenMainPage(page, secondary)),
    onHideDialog: () => dispatch(setDialogVisible(undefined)),
  };
}

function registerMainPage(
  instanceProps: IBaseProps,
  icon: string,
  title: string,
  component: React.ComponentClass<any> | React.StatelessComponent<any>,
  options: IMainPageOptions) {
  return {
    icon, title, component,
    propsFunc: options.props || emptyFunc,
    visible: options.visible || trueFunc,
    group: options.group,
    badge: options.badge,
    activity: options.activity,
  };
}

export default
  extend(registerMainPage)(
    connect(mapStateToProps, mapDispatchToProps)(MainWindow),
  ) as React.ComponentClass<IBaseProps>;
