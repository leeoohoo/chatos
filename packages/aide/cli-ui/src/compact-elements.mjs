import { getCompactStyles } from './compact-styles.mjs';

export function createCompactElements({ ctx, bridgeEnabled }) {
  const root = document.createElement('div');
  root.className = 'aide-compact-root';

  const style = document.createElement('style');
  style.textContent = getCompactStyles();
  root.appendChild(style);

  const header = document.createElement('div');
  header.className = 'aide-compact-header';
  const headerLeft = document.createElement('div');
  headerLeft.style.display = 'flex';
  headerLeft.style.flexDirection = 'column';
  headerLeft.style.gap = '4px';
  const title = document.createElement('div');
  title.className = 'aide-compact-title';
  title.textContent = 'AIDE 半屏概览';
  const meta = document.createElement('div');
  meta.className = 'aide-compact-meta';
  meta.textContent = `${ctx?.pluginId || ''}:${ctx?.appId || ''} · compact · bridge=${bridgeEnabled ? 'on' : 'off'}`;
  headerLeft.appendChild(title);
  headerLeft.appendChild(meta);
  const headerRight = document.createElement('div');
  const refreshButton = document.createElement('button');
  refreshButton.className = 'aide-compact-button';
  refreshButton.textContent = '刷新';
  refreshButton.disabled = !bridgeEnabled;
  headerRight.appendChild(refreshButton);
  header.appendChild(headerLeft);
  header.appendChild(headerRight);

  const body = document.createElement('div');
  body.className = 'aide-compact-body';

  const alert = document.createElement('div');
  alert.className = 'aide-compact-alert';
  alert.style.display = 'none';
  body.appendChild(alert);

  const tabBar = document.createElement('div');
  tabBar.className = 'aide-compact-tabs';
  const overviewTab = document.createElement('button');
  overviewTab.type = 'button';
  overviewTab.className = 'aide-compact-tab is-active';
  overviewTab.textContent = '概览';
  const traceTab = document.createElement('button');
  traceTab.type = 'button';
  traceTab.className = 'aide-compact-tab';
  traceTab.textContent = '轨迹';
  tabBar.appendChild(overviewTab);
  tabBar.appendChild(traceTab);
  body.appendChild(tabBar);

  const overviewSection = document.createElement('div');
  overviewSection.className = 'aide-compact-section';
  const traceSection = document.createElement('div');
  traceSection.className = 'aide-compact-section';

  const conversationCard = document.createElement('div');
  conversationCard.className = 'aide-compact-card';
  const conversationHeader = document.createElement('div');
  conversationHeader.className = 'aide-compact-card-header';
  const conversationTitle = document.createElement('div');
  conversationTitle.className = 'aide-compact-card-title';
  conversationTitle.textContent = '最近对话';
  const conversationMeta = document.createElement('div');
  conversationMeta.className = 'aide-compact-card-meta';
  conversationHeader.appendChild(conversationTitle);
  conversationHeader.appendChild(conversationMeta);
  const conversationList = document.createElement('div');
  conversationList.className = 'aide-compact-list';
  conversationCard.appendChild(conversationHeader);
  conversationCard.appendChild(conversationList);

  const sessionsCard = document.createElement('div');
  sessionsCard.className = 'aide-compact-card';
  const sessionsHeader = document.createElement('div');
  sessionsHeader.className = 'aide-compact-card-header';
  const sessionsTitle = document.createElement('div');
  sessionsTitle.className = 'aide-compact-card-title';
  sessionsTitle.textContent = '后台会话';
  const sessionsMeta = document.createElement('div');
  sessionsMeta.className = 'aide-compact-card-meta';
  const sessionsHeaderRight = document.createElement('div');
  sessionsHeaderRight.style.display = 'flex';
  sessionsHeaderRight.style.alignItems = 'center';
  sessionsHeaderRight.style.gap = '8px';
  const sessionsRefresh = document.createElement('button');
  sessionsRefresh.className = 'aide-compact-button';
  sessionsRefresh.textContent = '刷新';
  sessionsRefresh.disabled = !bridgeEnabled;
  sessionsHeaderRight.appendChild(sessionsMeta);
  sessionsHeaderRight.appendChild(sessionsRefresh);
  sessionsHeader.appendChild(sessionsTitle);
  sessionsHeader.appendChild(sessionsHeaderRight);
  const sessionsList = document.createElement('div');
  sessionsList.className = 'aide-compact-list';
  sessionsCard.appendChild(sessionsHeader);
  sessionsCard.appendChild(sessionsList);

  const filesCard = document.createElement('div');
  filesCard.className = 'aide-compact-card';
  const filesHeader = document.createElement('div');
  filesHeader.className = 'aide-compact-card-header';
  const filesTitle = document.createElement('div');
  filesTitle.className = 'aide-compact-card-title';
  filesTitle.textContent = '文件改动';
  const filesMeta = document.createElement('div');
  filesMeta.className = 'aide-compact-card-meta';
  const filesHeaderRight = document.createElement('div');
  filesHeaderRight.style.display = 'flex';
  filesHeaderRight.style.alignItems = 'center';
  filesHeaderRight.style.gap = '8px';
  const filesRefresh = document.createElement('button');
  filesRefresh.className = 'aide-compact-button';
  filesRefresh.textContent = '刷新';
  filesRefresh.disabled = !bridgeEnabled;
  filesHeaderRight.appendChild(filesMeta);
  filesHeaderRight.appendChild(filesRefresh);
  filesHeader.appendChild(filesTitle);
  filesHeader.appendChild(filesHeaderRight);
  const filesList = document.createElement('div');
  filesList.className = 'aide-compact-list';
  const filesPagination = document.createElement('div');
  filesPagination.className = 'aide-compact-pagination';
  const filesPageText = document.createElement('div');
  const filesControls = document.createElement('div');
  filesControls.className = 'aide-compact-pagination-controls';
  const filesPrev = document.createElement('button');
  filesPrev.className = 'aide-compact-button';
  filesPrev.textContent = '上一页';
  const filesNext = document.createElement('button');
  filesNext.className = 'aide-compact-button';
  filesNext.textContent = '下一页';
  filesControls.appendChild(filesPrev);
  filesControls.appendChild(filesNext);
  filesPagination.appendChild(filesPageText);
  filesPagination.appendChild(filesControls);
  filesCard.appendChild(filesHeader);
  filesCard.appendChild(filesList);
  filesCard.appendChild(filesPagination);

  const traceCard = document.createElement('div');
  traceCard.className = 'aide-compact-card';
  const traceHeader = document.createElement('div');
  traceHeader.className = 'aide-compact-card-header';
  const traceTitle = document.createElement('div');
  traceTitle.className = 'aide-compact-card-title';
  traceTitle.textContent = '轨迹';
  const traceMeta = document.createElement('div');
  traceMeta.className = 'aide-compact-card-meta';
  traceHeader.appendChild(traceTitle);
  traceHeader.appendChild(traceMeta);
  const traceList = document.createElement('div');
  traceList.className = 'aide-compact-list';
  const tracePagination = document.createElement('div');
  tracePagination.className = 'aide-compact-pagination';
  const tracePageText = document.createElement('div');
  const traceControls = document.createElement('div');
  traceControls.className = 'aide-compact-pagination-controls';
  const tracePrev = document.createElement('button');
  tracePrev.className = 'aide-compact-button';
  tracePrev.textContent = '上一页';
  const traceNext = document.createElement('button');
  traceNext.className = 'aide-compact-button';
  traceNext.textContent = '下一页';
  traceControls.appendChild(tracePrev);
  traceControls.appendChild(traceNext);
  tracePagination.appendChild(tracePageText);
  tracePagination.appendChild(traceControls);
  traceCard.appendChild(traceHeader);
  traceCard.appendChild(traceList);
  traceCard.appendChild(tracePagination);
  traceSection.appendChild(traceCard);

  overviewSection.appendChild(conversationCard);
  overviewSection.appendChild(sessionsCard);
  overviewSection.appendChild(filesCard);
  body.appendChild(overviewSection);
  body.appendChild(traceSection);

  const floatBar = document.createElement('div');
  floatBar.className = 'aide-compact-float';

  const floatRow = document.createElement('div');
  floatRow.className = 'aide-compact-float-row';
  const floatText = document.createElement('div');
  floatText.className = 'aide-compact-float-text';
  const floatToggle = document.createElement('button');
  floatToggle.className = 'aide-compact-button is-mini';
  floatToggle.textContent = '收起';
  floatRow.appendChild(floatText);
  floatRow.appendChild(floatToggle);

  const floatPanel = document.createElement('div');
  floatPanel.className = 'aide-compact-float-panel';
  const floatRunRow = document.createElement('div');
  floatRunRow.className = 'aide-compact-float-row';
  const runSelect = document.createElement('select');
  runSelect.className = 'aide-compact-select';
  runSelect.style.flex = '1';
  const runStatus = document.createElement('div');
  runStatus.className = 'aide-compact-row-text';
  runStatus.style.whiteSpace = 'nowrap';
  runStatus.style.maxWidth = '180px';
  runStatus.style.overflow = 'hidden';
  runStatus.style.textOverflow = 'ellipsis';
  const floatRefresh = document.createElement('button');
  floatRefresh.className = 'aide-compact-button is-mini';
  floatRefresh.textContent = '刷新';
  floatRefresh.disabled = !bridgeEnabled;
  floatRunRow.appendChild(runSelect);
  floatRunRow.appendChild(runStatus);
  floatRunRow.appendChild(floatRefresh);

  const dispatchInput = document.createElement('textarea');
  dispatchInput.className = 'aide-compact-input';
  dispatchInput.placeholder = '输入要发送给 CLI 的内容（Enter 发送，Shift+Enter 换行）';

  const floatActions = document.createElement('div');
  floatActions.className = 'aide-compact-float-actions';
  const stopButton = document.createElement('button');
  stopButton.className = 'aide-compact-button';
  stopButton.textContent = '停止';
  stopButton.disabled = true;
  const sendButton = document.createElement('button');
  sendButton.className = 'aide-compact-button';
  sendButton.textContent = '发送';
  sendButton.disabled = !bridgeEnabled;
  floatActions.appendChild(stopButton);
  floatActions.appendChild(sendButton);

  floatPanel.appendChild(floatRunRow);
  floatPanel.appendChild(dispatchInput);
  floatPanel.appendChild(floatActions);

  floatBar.appendChild(floatRow);
  floatBar.appendChild(floatPanel);

  const overlay = document.createElement('div');
  overlay.className = 'aide-compact-overlay';
  const overlayPanel = document.createElement('div');
  overlayPanel.className = 'aide-compact-overlay-panel';
  const overlayHeader = document.createElement('div');
  overlayHeader.className = 'aide-compact-overlay-header';
  const overlayTitle = document.createElement('div');
  overlayTitle.style.fontWeight = '700';
  const overlayActions = document.createElement('div');
  overlayActions.className = 'aide-compact-actions';
  const overlayRefresh = document.createElement('button');
  overlayRefresh.className = 'aide-compact-button is-mini';
  overlayRefresh.textContent = '刷新';
  overlayRefresh.style.display = 'none';
  const overlayClose = document.createElement('button');
  overlayClose.className = 'aide-compact-button is-mini';
  overlayClose.textContent = '关闭';
  overlayActions.appendChild(overlayRefresh);
  overlayActions.appendChild(overlayClose);
  overlayHeader.appendChild(overlayTitle);
  overlayHeader.appendChild(overlayActions);
  const overlayBody = document.createElement('div');
  overlayBody.className = 'aide-compact-overlay-body';
  overlayPanel.appendChild(overlayHeader);
  overlayPanel.appendChild(overlayBody);
  overlay.appendChild(overlayPanel);

  root.appendChild(header);
  root.appendChild(body);
  root.appendChild(floatBar);
  root.appendChild(overlay);

  return {
    root,
    header,
    refreshButton,
    body,
    alert,
    tabBar,
    overviewTab,
    traceTab,
    overviewSection,
    traceSection,
    conversationMeta,
    conversationList,
    sessionsMeta,
    sessionsRefresh,
    sessionsList,
    filesMeta,
    filesRefresh,
    filesList,
    filesPageText,
    filesPrev,
    filesNext,
    traceMeta,
    traceList,
    tracePageText,
    tracePrev,
    traceNext,
    floatBar,
    floatText,
    floatToggle,
    floatPanel,
    runSelect,
    runStatus,
    floatRefresh,
    dispatchInput,
    stopButton,
    sendButton,
    overlay,
    overlayTitle,
    overlayBody,
    overlayRefresh,
    overlayClose,
  };
}
