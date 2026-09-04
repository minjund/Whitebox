'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const SYNTAX_CHECK_FILES = [
  'main.js',
  'preload.js',
  'bin/whitebox.js',
  'src/bridgeServer.js',
  'src/providerRegistry.js',
  'src/platformPath.js',
  'src/agentMonitor.js',
  'src/automationMonitor.js',
  'src/agentRunner.js',
  'src/tmuxMonitor.js',
  'src/tmuxController.js',
  'src/terminalManager.js',
  'src/terminalHost.js',
  'src/terminalHostDaemon.js',
  'src/processMonitor.js',
  'src/monitorWorker.js',
  'src/attentionNotifier.js',
  'src/sessionIntelligence.js',
  'src/providerVisibilityStore.js',
  'src/updateInstaller.js',
  'src/windowsShellIdentity.js',
  'src/ipc/registerAppIpc.js',
  'src/ipc/registerAgentIpc.js',
  'src/ipc/registerTerminalIpc.js',
  'src/ipc/registerTmuxIpc.js',
  'src/ipc/registerWorkspaceIpc.js',
  'renderer/i18n-messages.js',
  'renderer/i18n.js',
  'renderer/conversation-delivery.js',
  'renderer/shared.js',
  'renderer/ime-submit.js',
  'renderer/app.js',
  'renderer/app-provider-visibility.js',
  'renderer/app-dashboard.js',
  'renderer/app-graph-model.js',
  'renderer/app-graph-view.js',
  'renderer/app-graph-layout.js',
  'renderer/app-graph-orchestration.js',
  'renderer/app-agent-actions.js',
  'renderer/app-management.js',
  'renderer/app-session-render.js',
  'renderer/app-pty-focus.js',
  'renderer/app-drawer-data.js',
  'renderer/app-drawer-content.js',
  'renderer/app-drawer.js',
  'renderer/app-run-modal.js',
  'renderer/app-quality.js',
  'renderer/app-events-navigation.js',
  'renderer/app-events-sessions.js',
  'renderer/app-events-filters.js',
  'renderer/app-events-dialogs.js',
  'renderer/app-events.js',
  'renderer/attention-activation.js',
  'renderer/app-bootstrap.js',
  'renderer/terminal-workbench.js',
  'renderer/terminal-agent.js',
  'renderer/terminal-events.js',
  'renderer/terminal-prompt.js',
  'renderer/terminal.js',
  'renderer/inline-agent-terminal.js',
  'scripts/bridge-integration-test.js',
  'scripts/organize-css.js',
];

const REQUIRED_UI_IDS = [
  'mainContent',
  'beginnerGuide',
  'guideBtn',
  'guideProgressBar',
  'dismissGuideBtn',
  'operationsOverview',
  'providerOverview',
  'liveSection',
  'controlRoomProjectToolbar',
  'workspaceList',
  'addWorkspaceBtn',
  'controlRoomListToolbar',
  'controlRoomSortSelect',
  'controlRoomProjectSelect',
  'controlRoomSearch',
  'controlRoomSearchInput',
  'controlRoomSearchBtn',
  'controlRoomExpandAll',
  'controlRoomCollapseAll',
  'agentMapToolbar',
  'liveSessionGrid',
  'activeEmptyState',
  'graphBreadcrumbs',
  'graphResetBtn',
  'terminalRuntimeMount',
  'sessionGrid',
  'loadMoreBtn',
  'ptyFocusSurface',
  'ptyFocusBackBtn',
  'ptyFocusFlow',
  'ptyFocusTerminalShell',
  'ptyFocusTerminalViewport',
  'drawerBackdrop',
  'detailDrawer',
  'drawerTabChat',
  'drawerContent',
  'drawerComposer',
  'runModal',
  'quickPaletteModal',
  'quickPaletteInput',
  'shortcutHelpModal',
  'shortcutHelpBtn',
  'sessionResultSummary',
  'emptyClearFiltersBtn',
  'clearRunDraftBtn',
  'sidebarAppVersion',
  'backToProjectsBtn',
  'projectSelectionPrompt',
  'settingsSection',
  'languageSettingsTitle',
  'languageSelect',
  'providerVisibilityList',
  'currentVersion',
  'latestVersion',
  'checkUpdateBtn',
  'updateStateTitle',
];

const REMOVED_UI_IMPLEMENTATIONS = [
  'renderer/attention-popup.html',
  'renderer/attention-popup.js',
  'renderer/attention-popup.css',
  'renderer/app-attention-popup-settings.js',
  'src/attentionPopupManager.js',
  'src/attentionPopupPreferenceStore.js',
  'renderer/drawer-terminal.js',
  'renderer/app-runtime-overview.js',
  'renderer/app-tmux-render.js',
  'renderer/styles-runtime-overview.css',
  'renderer/terminal-composer.js',
];

const REMOVED_UI_IDS = [
  'mobileMoreBtn',
  'mobileToolsMenu',
  'advancedToolsNav',
  'ptyFocusChildModal',
  'ptyFocusChildBody',
  'attentionPopupSettingsCard',
  'attentionPopupEnabled',
  'automationOverview',
  'tmuxSection',
  'tmuxCreateModal',
  'tmuxControlSection',
  'tmuxWorkbenchMount',
  'tmuxStats',
  'tmuxBreadcrumbs',
  'tmuxResetBtn',
  'tmuxMap',
  'terminalTmuxList',
  'newTmuxSessionBtn',
  'tmuxCreateForm',
  'tmuxCreateName',
  'tmuxCreateCwd',
  'tmuxCreateCommand',
  'terminalSection',
  'terminalWorkbench',
  'terminalWorkbenchMount',
  'terminalStage',
  'terminalHistoryPanel',
  'terminalHistoryList',
  'terminalViewport',
  'terminalCommandForm',
  'terminalSessionList',
  'terminalCommandClearBtn',
  'terminalSlashMenu',
  'terminalSlashMenuList',
  'terminalSlashTrigger',
  'terminalLongDraftMeta',
  'terminalLongDraftToggle',
  'terminalFontDecreaseBtn',
  'terminalFontIncreaseBtn',
  'terminalFontSizeLabel',
  'terminalFocusBtn',
];

const RUN_COMPOSER_IDS = [
  'runPromptCount', 'runWorkspaceSuggestions',
  'runClaudePermissionModeField', 'runClaudePermissionMode', 'runClaudePermissionModeHelp',
];
const BEGINNER_GUIDE_LABELS = [
  '첫 10분 코스',
  '이 네 가지만 익히면 충분해요',
  '새 AI 작업',
  '진행 중인 작업 확인',
  '확인할 일 보기',
  '담당 노드 PTY',
  'PTY 열어보기',
];

const DISALLOWED_UI_JARGON = [
  'AI AGENT OBSERVATORY',
  'SESSION STREAM',
  'AGENT MIND MAP',
  'NEW TMUX SESSION',
  '기억에서 증거 찾기',
  '내 응답과 상태 신호 확인',
  '인과 기억',
  '끝난 의도',
  '보존된 계보',
  '에이전트 운영 상태',
];

const SEMANTIC_UI_COPY = [
  '현재 상태를 확실히 알 수 없음',
  '최근 활동',
  '작업 화면을 열어 현재 상태 확인 필요',
  '완료 기록 확인됨',
  '완료 기록을 찾지 못함',
  '작업 기록에서 찾은 파일과 결과',
  '작업 기록에 남은 테스트 결과',
  '네, ‘{name}’으로 변경',
  '지금은 바꾸지 않기',
  '다른 AI로 새 작업 만들기',
  '현재 설치된 버전',
  '내 답변을 기다리는 중',
  '완료 여부를 직접 확인해야 하는 작업',
  '2분 이상 새 활동 없음',
  'AI가 한 번에 참고할 수 있는 양을 75% 이상 사용',
  '이 일을 맡긴 담당 AI 정보를 찾지 못함',
  '현재 실행 중인 작업',
  '전체 지난 작업 {total}건 · 작업 완료 {new}건 · 기록된 결정 {decisions}건',
  '실행 횟수',
  '컴퓨터 작업과 AI 대화',
  '다른 컴퓨터의 작업',
  '작업 폴더',
  '함께 작업하는 AI',
  '담당 AI가 나눠 맡긴 작업',
];

const AMBIGUOUS_KO_MESSAGE_VALUES = [
  '근거 부족',
  '실행 건강 상태',
  '높은 신뢰도',
  '보통 신뢰도',
  '낮은 신뢰도',
  '검증 필요',
  '완료 이벤트 확인',
  '구조화된 진행 상황',
  '관측된 산출물',
  '테스트·검증 기록',
  '승인하고 계속',
  '거절하고 중단',
  '다른 AI로 넘기기',
  '사용 가능한 AI',
  '확인·주의',
  '예약·반복',
  '대화·명령창',
  '동시에 유지 가능',
  '최근 활동이 지연됨',
  '작업 정체 감지',
  '서브 AI',
  '실행 시작 관측',
  '관측된 반복 정보',
  '근거와 상세 보기',
  '여러 창 작업 만들기',
  '조치 필요',
  '에이전트 루프 실행 중',
  '에이전트 메시지',
  '작업공간 미지정',
  'AI 작업 위치',
  'AI 작업 관리 상태',
];

const MANAGEMENT_SEMANTIC_CONTRACTS = [
  'function matchesManagementFilter',
  'EXPLICIT_ATTENTION_SOURCES.has(session.attention.source)',
  'ACTIONABLE_RISK_SIGNALS.has(signal.code)',
  'RECENT_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000',
  'function managementBucket(session, now = Date.now())',
  'needsManagementReview',
  'needsManagementInbox',
  'data-attention-category',
  'signals.length',
  'loggedRatio',
  'attention.kind === "approval"',
  't("management.detected")',
  'function renderOperationsOverview',
  'function renderHomeAttention',
  'data-home-attention',
  'control.attention_title',
  'attention-decision-flow',
  'latestAgentReply',
  'management.flow_agent_reply',
  'management.flow_my_check',
  'management.flow_my_reply',
  'attention-evidence-details',
  'sessionOrder',
  'function stableSessionSort',
  'function moveSessionOrder',
  'bindSortableSessionList',
  'data-session-sortable',
  'data-session-drop-edge',
  'saveDashboardPreferences();',
];

const MONITOR_WORKER_CONTRACTS = [
  'function cardCollaboration',
  'collaboration: cardCollaboration(session.collaboration)',
  'function cardExecutions',
  'executions: cardExecutions(session.executions)',
  'taskName: session.taskName',
  'completionObserved: Boolean(session.completionObserved)',
  'attention: session.attention',
  'progress: session.progress',
  'health: session.health',
  'controlCapabilities: session.controlCapabilities',
  'evidence: session.evidence',
  'outcome: session.outcome',
  'projectless: Boolean(session.projectless)',
  'originCwd: session.originCwd || session.cwd',
  'loop: session.loop',
  'session.collaboration && session.collaboration.metrics',
  'session.collaboration && session.collaboration.communications',
  'scanCodexAutomationHomes',
  'automations,',
];

const APP_MODULES = [
  'app.js',
  'app-provider-visibility.js',
  'app-dashboard.js',
  'app-graph-model.js',
  'app-graph-view.js',
  'app-graph-layout.js',
  'app-graph-orchestration.js',
  'app-agent-actions.js',
  'app-management.js',
  'app-session-render.js',
  'app-drawer-data.js',
  'app-drawer-content.js',
  'app-pty-focus.js',
  'app-drawer.js',
  'app-run-modal.js',
  'app-quality.js',
  'app-events-navigation.js',
  'app-events-sessions.js',
  'app-events-filters.js',
  'app-events-dialogs.js',
  'app-events.js',
  'attention-activation.js',
  'app-bootstrap.js',
];

const APP_PUBLIC_API_CONTRACTS = [
  'window.WhiteboxAppFactories',
  'createCore',
  'createGraphModel',
  'createGraphView',
  'createGraphLayout',
  'createGraphOrchestration',
  'createSessionRenderer',
  'createAgentActions',
  'createManagement',
  'createDrawerData',
  'createDrawerContent',
  'createDrawer',
  'createRunModal',
  'createQualityEnhancements',
  'createEventBindings',
  'window.WhiteboxApp = app',
];

const APP_READABILITY_CONTRACTS = [
  'function readablePreview',
  'function roadmapHtml',
  'function runWorkspaceSuggestionsHtml',
  'function syncRunComposer',
  'function renderUpdateSettings',
  'function renderGuide',
  'function markGuideStep',
  'function trapDialogFocus',
  'function selectView',
  'sidebarAppVersion',
  'ui.you_are_up_to_date',
];

const AGENT_GRAPH_CONTRACTS = [
  'function renderAgentMap',
  'function connectedGraphSessions',
  'function providerFlowLane',
  'function focusedGraph',
  'function workflowCompactNode',
  'function workflowChildrenSummary',
  'function workflowMetrics',
  'function workflowCommunicationPanel',
  'function subagentWorkState',
  'function splitSubagents',
  'function completedSubagentDisclosure',
  'function agentExecutionMode',
  'function executionModeBadge',
  'function executionActivityPanel',
  'data-execution-activity',
  'data-execution-kind',
  'data-execution-mode',
  'data-execution-status',
  'function controlRoomSession',
  'function controlRoomChildNode',
  'function controlRoomExecutionNode',
  'function controlRoomSummary',
  'function controlRoomAgentGoal',
  'function controlRoomProject',
  'function runtimeSeparatedOverview',
  'function inferredExecutionSummary',
  'function openExecutionActivity',
  'data-control-summary',
  'data-open-execution-id',
  'data-control-room-overview',
  'data-control-project',
  'control-room-project-group',
  'data-control-session',
  'data-session-archive',
  'function isControlRoomSession',
  'control.waiting_background_session',
  'is-unverified',
  'function archiveSession',
  'function isRuntimeLoopSession',
  'function openSubagentConversation',
  'function resumeAgentTerminal',
];

const COLLABORATION_VIEW_CONTRACTS = [
  'data-collaboration-metric',
  'data-collaboration-communications',
  'data-open-subagent-chat',
  'openSubagentConversation(subagentChat.dataset.openSubagentChat, { context: true })',
  'data-subagent-completed-toggle',
  'graph.created_in_task',
  'graph.simultaneous_capacity',
  'graph.currently_running',
  'graph.completed_records',
  'graph.communication_title',
  'graph.tmux_used',
  'graph.tmux_not_used',
  'graph.completed_subagents',
  'graph.execution_activity',
  'graph.shell_foreground',
  'graph.shell_background',
  'graph.background_task',
  'child-session',
  'agent-flow-session-title',
  'agent-flow-outcome-copy',
  'children-group-input',
];

const WORKFLOW_INTERACTION_CONTRACTS = [
  'function drawAgentWorkflowConnections',
  'function workflowCurve',
  'data-workflow-edge-kind',
  'function captureMotionLayout',
  'function playMotionLayout',
  'function motionEnterOffset',
  'function animateVisibleSections',
  'function agentCommandComposer',
  'function agentCommandRouteOptions',
  'function selectedAgentCommandRoute',
  'function routedAgentCommandContext',
  'function originAppInfo',
  'function agentControlMode',
  'function dispatchAgentCommand',
  'function interruptConversation',
  'data-conversation-interrupt',
  '{ focus: false, deliveryId }',
  'function openAgentTerminal',
  'function copyBridgeCommand',
  'data-agent-command-form',
  'data-agent-command-draft',
  'data-agent-command-route-selected',
  'data-conversation-slash-menu',
  'data-agent-terminal-open',
  'data-agent-bridge-copy',
  'agent.direct_status',
  'agent.handoff_status',
  'agent.resume_status',
  'agent.origin_resume_status',
  'agent.background_and_send',
  'ui.ended_session',
  'agent.send_now',
];

const MOTION_AND_MAP_CONTRACTS = [
  'data-motion-key',
  'data-motion-value',
  'dataset.lastMotion',
  'motion-connect',
  'pathLength="1"',
  'prefers-reduced-motion: reduce',
  'data-graph-provider-more',
  'control-room-overview',
  'agent-workflow-canvas',
  'data-workflow-port',
  'graph.assigning_ai',
  'graph.selected_ai',
  'graph.subagent_sessions',
];

const TERMINAL_VIEW_CONTRACTS = [
  'function messageContentHtml',
  'function memoryCandidatesHtml',
  'conversationTurnLimits',
  'data-graph-focus',
  'data-open-session',
];

const DRAWER_TERMINAL_CONTRACTS = [
  'function openPtyFocus',
  'function openPtyFocusForTerminal',
  'function syncPendingPtyFocus',
  'data-pty-focus-trigger',
  'ptyFocusTerminalViewport',
  'enterFocus',
  'mountForAgent',
  'startAgent',
  'creationId',
];

const APP_AGENT_CONTRACTS = [
  ...AGENT_GRAPH_CONTRACTS,
  ...COLLABORATION_VIEW_CONTRACTS,
  ...WORKFLOW_INTERACTION_CONTRACTS,
  ...MOTION_AND_MAP_CONTRACTS,
  ...TERMINAL_VIEW_CONTRACTS,
];

const STYLE_FILES = [
  'styles-bundle.css',
  'styles.css',
  'styles-components.css',
  'styles-cards.css',
  'styles-overlays.css',
  'styles-agent-map.css',
  'styles-workflows.css',
  'styles-workflow-map.css',
  'styles-collaboration.css',
  'styles-tmux.css',
  'styles-terminal.css',
  'styles-run-composer.css',
  'styles-product.css',
  'styles-management.css',
  'styles-onboarding.css',
  'styles-settings.css',
  'styles-quality.css',
  'styles-responsive-shell.css',
  'styles-responsive-workflows.css',
  'styles-responsive-runtime.css',
  'styles-responsive-product.css',
  'styles-control-room.css',
  'styles-pty-focus.css',
];

const I18N_RUNTIME_CONTRACTS = [
  "const DEFAULT_LOCALE = 'en'",
  "'ko', 'en', 'zh-CN'",
  'whitebox:locale:v1',
  'return SUPPORTED.has(saved) ? saved : DEFAULT_LOCALE',
  'window.WhiteboxI18n',
  'whitebox:locale-changed',
  'MutationObserver',
  'function t(key, params)',
  'function errorText(error, fallbackKey, params)',
  'function observedText(value)',
  'data-i18n',
];

const I18N_MESSAGE_CONTRACTS = [
  'window.WhiteboxMessages',
  'settings.title',
  'Language, screen, AI list, and updates',
  '语言、画面、AI 列表和更新',
  'common.progress',
  'time.seconds_ago',
  'control.all_projects',
  'control.add_project',
  'control.page_summary',
  'control.project_filter',
  'control.search_sessions',
  'control.sort_sessions',
];

const LEGACY_I18N_INFERENCE_CONTRACTS = [
  'const rows',
  'applyRules',
  'createTreeWalker',
  'textSources',
  'attributeSources',
  'catalog[core]',
];

const CSS_RESPONSIBILITY_HEADINGS = [
  'Foundation',
  'Shared components',
  'Session cards and metrics',
  'Overlays and transient UI',
  'Agent map',
  'Agent workflows',
  'Directed workflow map',
  'Collaboration detail',
  'Terminal workspaces',
  'Product experiences',
  'Run composer',
  'Onboarding and navigation help',
  'Settings and releases',
  'Responsive shell and shared components',
  'Responsive agent workflows',
  'Responsive terminal and live tmux surfaces',
  'Responsive product surfaces',
];

const READABILITY_STYLE_CONTRACTS = [
  'chat-roadmap',
  'agent-goal-note',
  'new-run-cta',
  'run-composer',
  'run-modal-actions',
];

const INTERACTION_STYLE_CONTRACTS = [
  '--motion-ease',
  'motion-section-in',
  'motion-live-update',
  'motion-edge-draw',
  'motion-modal-in',
  'motion-modal-out',
  'motion-toast-in',
  'motion-toast-out',
  'agent-command-panel',
  'agent-command-input',
  'live-tmux-shortcut',
  'terminal-stage',
  'terminal-history-panel',
  'terminal-history-message',
  'terminal-console-pane',
  'terminal-console-head',
  'terminal-command-composer',
  'terminal-resource-tip',
  'agent-workflow-summary',
  'workflow-summary-chip',
  'density-many',
  'agent-workflow-edge.downstream.group',
  'agent-flow-session-title',
  'agent-flow-outcome-copy',
  'completed-subagent-disclosure',
  'completed-subagent-list',
  'execution-mode-badge',
  'work-working',
  'work-resting',
  'provider-filter-check',
  'provider-filter-confirm',
  'poc-filter-state',
  'resume-ready',
  'control-handoff',
  'control-origin-resume',
  'conversation-slash-menu',
  'conversation-slash-command',
];

const QUALITY_201_300_APP_CONTRACTS = [
  'QUALITY_PREF_STORAGE_KEY',
  'QUALITY_PREF_VERSION = 3',
  'function qualityText',
  'function defaultQualityPreferences',
  'function loadQualityPreferences',
  'function saveQualityPreferences',
  'function applyQualityPreferences',
  'function markInputModality',
  'function describeControl',
  'function enhanceControl',
  'function enhanceQualityControls',
  'function installQualityMutationObserver',
  'function installPressedStateMirrors',
  'function installFormRecovery',
  'function installDetailsStateMemory',
  'function installOverflowTitles',
  'function installViewportSafetyClass',
  'function installGlobalQualityGuards',
  'qualityGuardsInstalled',
  'data-quality-disabled-reason',
  'data-quality-touch-target',
  'data-quality-pressed',
  'data-quality-control',
  'aria-required',
  'body.dataset.inputModality',
  'body.dataset.qualityMotion',
  'body.dataset.qualityDensity',
  'document.documentElement.dataset.qualityViewport',
  'roots.forEach(enhanceQualityControls)',
  'MutationObserver',
];

const QUALITY_201_300_STYLE_CONTRACTS = [
  'Quality pass 201–300',
  'body.quality-keyboard-mode :focus-visible',
  '[data-quality-control]',
  '[data-quality-pressed="true"]',
  '[data-quality-disabled="true"]',
  '[data-quality-touch-target="padded"]::after',
  '[data-quality-density="compact"] .session-grid',
  '[data-quality-motion="reduced"] *',
  '[data-quality-viewport="mobile"] .quality-modal',
  'touch-action: manipulation',
  'cursor: not-allowed',
  'outline: 3px solid #77e2c2',
];

const QUALITY_201_300_I18N_CONTRACTS = [
  'quality.disabled_reason',
  'Unavailable for the current state.',
  '当前状态不可用。',
];

const TERMINAL_RUNTIME_CONTRACTS = [
  'window.Terminal',
  'FitAddon.FitAddon',
  'wslDistros',
  'terminalWrite',
  'terminalResize',
  'terminalReconnect',
  'terminalStop',
  'tmuxCapture',
  'function modeSessions',
  'function terminalTypeLabel',
  'function agentTargets',
  'terminal.bridgeId === agentSession.id',
  'function requiredAgentTarget',
  'function resumeSupport',
  'parentControlled: true',
  'CODEX_DESKTOP_SESSION_ORIGIN_OWNED',
  'WHITEBOX_BRIDGE_PROJECTION_ORIGIN_OWNED',
  "['codex', 'claude', 'gemini', 'grok']",
  "promptMode: provider === 'grok' ? 'terminal' : 'arguments'",
  "terminal.type === 'agent'",
  'sub-agent is controlled by its parent',
  'function resumeForAgent',
  "provider === 'codex' ? ['resume', sessionId] : ['--resume', sessionId]",
  'function dispatchAgentCommand',
  'function interruptAgent',
  'function openForAgent',
  'selectTmuxById',
  'window.WhiteboxTerminal',
  'window.whitebox.terminalReconnect(terminalId)',
  'window.whitebox.terminalStop?.(terminalId)',
  'entry.pendingResize',
  'if (!rehydratedIds.has(id)) state.commandDrafts.delete(id)',
  'embeddedResizeObserver.observe',
];

const IPC_MODULE_FILES = [
  'registerAppIpc.js',
  'registerAgentIpc.js',
  'registerTerminalIpc.js',
  'registerTmuxIpc.js',
  'registerWorkspaceIpc.js',
];

const MAIN_PROCESS_CONTRACTS = [
  'function backgroundTerminalSessions',
  'function backgroundAgentRuns',
  'function backgroundWorkloadCount',
  'function ensureBackgroundTray',
  'function updateBackgroundTrayMenu',
  'function mainText',
  '프로그램 끝내기 · 명령창은 유지, 직접 실행은 중지',
  'Quit · Keep terminals, stop direct runs',
  '退出 · 保留终端并停止直接运行',
  'new TerminalHostClient',
  "terminalManager.on('reconnect'",
  "terminalManager.on('reconnect-error'",
  'function connectTerminalForStartup',
  "reportRecoverableError('terminal-host-startup-connect'",
  "sendTerminal('terminals:connection'",
  'terminalManager.dispose({ shutdownIfIdle: true })',
  'let quitCleanupPromise = null',
  'let quitCleanupComplete = false',
  'function quitCleanupTask',
  'async function cleanupBeforeQuit',
  "quitCleanupTask('agent-runner', () => runner && runner.dispose())",
  "app.on('before-quit', event =>",
  'if (quitCleanupComplete) return',
  'if (quitCleanupPromise) return',
  'quitCleanupComplete = true',
  'setImmediate(() => app.quit())',
  "session?.status === 'running' || session?.status === 'starting'",
  '!isInternalTerminalProjectionSessionId(session.bridgeId)',
  "terminalSessions: sessions.filter(session => ['running', 'starting', 'stopping'].includes(session.status))",
  "session.status === 'detached'",
  'event.preventDefault()',
  'mainWindow.hide()',
  'const showFallback = setTimeout(showWindow, 2_000)',
  'function registerIpcHandlers',
  'function createAttentionNotifier',
  'const DESKTOP_NOTIFICATIONS_ENABLED = true',
  'enabled: DESKTOP_NOTIFICATIONS_ENABLED',
  "event === 'completed' ? 'completionTitle' : 'attentionTitle'",
  "completionFallback: 'AI 작업이 완료되었습니다.'",
  "completionFallback: 'The AI task is complete.'",
  "completionFallback: 'AI 任务已完成。'",
  "notificationDetail || mainText('completionFallback')",
  ": (notificationDetail || session.title || '이름 없는 작업')",
  'title: notificationCopy',
  'function notifyTerminalPrompt',
  "const snapshot = visibleSnapshotSessions(lastSnapshot)",
  "attentionNotifier.sync(snapshot)",
  "agents:attention-requested",
  "pendingAttentionSessionId",
  "markRendererReady",
  "readUpdateRelaunchRequest",
  "signalRendererReady",
  "updateRelaunchReady",
  "let updateInstallPromise = null",
  "function performDownloadedUpdateInstall",
  "async function updateInstallPlan",
  "findInstalledDesktopApp",
  "readDesktopAppVersion",
  "currentVersionKnown: updateCurrentVersionKnown",
  "blockedReason: updateBlockedReason",
  "installed-app-version",
  "async function confirmActiveTerminalUpdate",
  "installCanceled",
  "did-start-loading",
];

const APP_IPC_CHANNELS = [
  'app:renderer-ready',
  'app:background-state',
  'app:show',
  'app:set-locale',
  'app:notify-attention-prompt',
  'app:update-check',
  'app:update-download',
  'app:update-open',
  'app:update-install',
];

const TRUSTED_IPC_CHANNELS = [
  'app:bootstrap',
  'agents:snapshot',
  'agents:detail',
  'agents:run',
  'agents:stop',
  'agents:pause',
  'agents:resume-run',
  'agents:retry',
  'providers:probe',
  'workspaces:list',
  'workspaces:add',
  'workspaces:remove',
  'workspaces:pick',
  'external:open',
];

const PRELOAD_IPC_CONTRACTS = [
  'backgroundState',
  'showApp',
  'setLocale',
  'notifyAttentionPrompt',
  'checkForUpdate',
  'downloadUpdate',
  'openDownloadedUpdate',
  'installDownloadedUpdate',
  'onUpdateState',
  'onAttentionRequested',
  'onTerminalPromptResolved',
  'onTerminalConnection',
  'async function terminalWrite(id, data, options)',
  "ipcRenderer.invoke('terminals:write', id, data, options)",
  'terminalWrite,',
  "terminalResize: (id, cols, rows) => ipcRenderer.invoke('terminals:resize'",
  "terminalDetach: id => ipcRenderer.invoke('terminals:detach'",
  "terminalReconnect: id => ipcRenderer.invoke('terminals:reconnect'",
  "terminalStop: id => ipcRenderer.invoke('terminals:stop'",
  "terminalRetire: id => ipcRenderer.invoke('terminals:retire'",
  'pauseAgent',
  'resumeAgentRun',
  'retryAgent',
];

const LEGACY_NAME_TARGETS = [
  'main.js',
  'preload.js',
  'package.json',
  'README.md',
  'src',
  'renderer',
  'scripts',
];

const PRODUCT_NAME_TARGETS = [
  '.github',
  'bin',
  'docs',
  'main.js',
  'preload.js',
  'package.json',
  'README.md',
  'README.ko.md',
  'README.zh-CN.md',
  'src',
  'renderer',
  'scripts',
];

const RELEASE_WORKFLOW_CONTRACTS = [
  'tags:',
  '"v*"',
  'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
  'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
  'gh release create',
  'release/*.exe',
  'release/*.dmg',
  'release/*.zip',
  'Whitebox-Windows',
  'Whitebox-macOS',
  'npm_version.outputs.published',
  'id-token: write',
  'npm publish --access public --tag latest',
  'Verify npm publication',
  'npm run test:drawer-conversation',
  'npm run test:drawer-actual-pty',
];

function assertIncludesAll(source, contracts, messageForContract) {
  for (const contract of contracts) {
    assert.ok(
      source.includes(contract),
      messageForContract ? messageForContract(contract) : `${contract} 계약이 없습니다.`,
    );
  }
}

function assertExcludesAll(source, contracts, messageForContract) {
  for (const contract of contracts) {
    assert.equal(source.includes(contract), false, messageForContract(contract));
  }
}

function registerSyntaxContractTests(context) {
  const { test, root } = context;
  test('메인과 렌더러 JavaScript 문법이 유효하다', () => {
    for (const file of SYNTAX_CHECK_FILES) {
      execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
    }
  });

}

function registerUiContractTests(context) {
  const { test, root } = context;
  test('fork 가드와 provisional 브리지 정체성 변경은 binding 없이도 새 snapshot을 게시한다', () => {
    const source = fs.readFileSync(path.join(root, 'src', 'monitorWorker.js'), 'utf8');
    const helperStart = source.indexOf('function forkPublicationFingerprintState(');
    const helperEnd = source.indexOf('\nasync function publishSnapshot(', helperStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'monitor snapshot fingerprint helper를 찾지 못했습니다.');

    class FixedDate extends Date {
      static now() { return Date.parse('2026-08-24T00:00:00.000Z'); }
    }
    const sandbox = { Date: FixedDate };
    vm.runInNewContext(
      `${source.slice(helperStart, helperEnd)}\nthis.helpers = { fingerprint, snapshotNeedsPublication };`,
      sandbox,
      { filename: 'monitorWorker-fingerprint.js' },
    );
    const { fingerprint: monitorFingerprint, snapshotNeedsPublication } = sandbox.helpers;
    const snapshot = { sessions: [] };
    const tmux = { distros: [] };
    const forkBridge = {
      id: 'terminal:fork', terminalId: 'terminal:fork', provider: 'codex', pid: 777,
      cwd: 'D:\\repo', startedAt: '2026-08-24T00:00:00.000Z', environment: 'windows', distro: '',
      creationId: 'create:fork-one', forkProofAuthority: 'codex-fork-lineage-v1',
      agentForkSourceSessionId: 'codex:desktop-source',
      agentForkSourceSignature: `acs1:${'a'.repeat(64)}`,
    };
    const initialFingerprint = monitorFingerprint(snapshot, tmux, [], [], [], [forkBridge]);
    const guardedFingerprint = monitorFingerprint(
      snapshot,
      tmux,
      [],
      [],
      ['codex:fork-child'],
      [forkBridge],
    );
    const changedBridgeFingerprint = monitorFingerprint(
      snapshot,
      tmux,
      [],
      [],
      ['codex:fork-child'],
      [{ ...forkBridge, creationId: 'create:fork-two' }],
    );

    assert.notEqual(guardedFingerprint, initialFingerprint,
      'binding이 없어도 새 child 가드 세트는 게시 fingerprint를 바꿔야 합니다.');
    assert.equal(snapshotNeedsPublication(initialFingerprint, guardedFingerprint, []), true);
    assert.notEqual(changedBridgeFingerprint, guardedFingerprint,
      '같은 가드 세트라도 provisional fork 브리지 정체성이 바뀌면 다시 게시해야 합니다.');
    assert.equal(snapshotNeedsPublication(guardedFingerprint, changedBridgeFingerprint, []), true);
    assert.equal(snapshotNeedsPublication(changedBridgeFingerprint, changedBridgeFingerprint, []), false);
    assert.match(source,
      /fingerprint\(\s*runtimeSnapshot,\s*tmux,\s*automations,\s*sourceSnapshot\.statuses,\s*forkBindingGuardSessionIds,\s*currentBridges,\s*\)/,
      '실제 publish 경로가 fork 가드와 현재 브리지를 fingerprint에 전달해야 합니다.');
  });

  test('프로젝트 경로 정규화는 빈 경로와 POSIX 루트를 구분한다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-dashboard.js'), 'utf8');
    const helperStart = source.indexOf('function normalizedProjectPath(value)');
    const helperEnd = source.indexOf('function projectName(projectPath)', helperStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart, '프로젝트 경로 helper를 찾을 수 없습니다.');
    const sandbox = {};
    vm.runInNewContext(`${source.slice(helperStart, helperEnd)}\nthis.helpers = { normalizedProjectPath, projectContainsPath };`, sandbox, {
      filename: 'app-dashboard-project-path-helpers.js',
    });
    const { normalizedProjectPath, projectContainsPath } = sandbox.helpers;

    assert.equal(normalizedProjectPath(''), '');
    assert.equal(normalizedProjectPath(undefined), '');
    assert.equal(normalizedProjectPath('/'), '/');
    assert.equal(normalizedProjectPath('///'), '/');
    assert.equal(normalizedProjectPath('C:\\'), 'c:');
    assert.equal(normalizedProjectPath('/mnt/C/Users/Example/'), 'c:/users/example');
    assert.equal(projectContainsPath('/', '/workspace/project'), true);
    assert.equal(projectContainsPath('/', '/'), true);
    assert.equal(projectContainsPath('/', ''), false);
    assert.equal(projectContainsPath('', '/workspace/project'), false);
    assert.equal(projectContainsPath('/workspace', '/workspace/project'), true);
    assert.equal(projectContainsPath('/workspace', '/workspace-other'), false);
    assert.equal(projectContainsPath('C:\\', 'c:\\Users\\Example'), true);
  });

  test('최신 AI 요청에 답이 없으면 지난 답변을 새 응답처럼 붙이지 않는다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-session-render.js'), 'utf8');
    const sandbox = {
      window: {
        WhiteboxAppFactories: {},
        WhiteboxI18n: { t: key => key, observedText: value => value },
      },
    };
    vm.runInNewContext(source, sandbox, { filename: 'app-session-render.js' });
    const renderer = sandbox.window.WhiteboxAppFactories.createSessionRenderer({
      state: {},
      readablePreview: text => ({ text: String(text), full: String(text) }),
      providerInfo: provider => ({ label: provider }),
    });
    const waiting = renderer.recentConversation({
      provider: 'claude',
      messages: [
        { role: 'user', text: '지난 질문' },
        { role: 'assistant', text: '지난 답변' },
        { role: 'user', text: '아직 답이 없는 새 질문' },
      ],
    });
    assert.deepStrictEqual(
      Array.from(waiting, row => [row.tone, row.text]),
      [['user', '아직 답이 없는 새 질문']],
    );

    const answered = renderer.recentConversation({
      provider: 'claude',
      messages: [
        { role: 'user', text: '지난 질문' },
        { role: 'assistant', text: '지난 답변' },
        { role: 'user', text: '새 질문' },
        { role: 'assistant', text: '새 답변' },
      ],
    });
    assert.deepStrictEqual(
      Array.from(answered, row => [row.tone, row.text]),
      [['user', '새 질문'], ['assistant', '새 답변']],
    );

    const statusRenderer = sandbox.window.WhiteboxAppFactories.createSessionRenderer({
      state: {},
      esc: value => String(value),
      readablePreview: text => ({ text: String(text || ''), full: String(text || '') }),
      providerInfo: provider => ({ label: provider, mark: 'AI' }),
      providerStyle: () => '',
      sessionBadgesHtml: () => '',
      statusClass: status => status,
      currentActivity: () => ({ title: '실행 중인 명령', detail: '', type: 'tool' }),
      latestWorkCopy: () => '테스트 실행 중',
      statusIcon: () => '·',
      timeAgo: () => '방금',
      isProjectlessSession: () => false,
      sessionOriginPath: () => 'D:\\repo',
      sessionWorkspaceLabel: () => 'repo',
      controlRoomStatus: () => 'running',
      sessionStatusLabel: (_session, status) => status,
    });
    const projected = statusRenderer.sessionCard({
      id: 'projected-running', provider: 'codex', model: 'gpt', title: '진행 중인 작업',
      status: 'idle', activityState: 'idle', statusDetail: '다음 요청 대기', messages: [],
      updatedAt: '2026-08-24T00:00:00.000Z',
    });
    assert.match(projected, /status-pill running activity-working">running<\/span>/,
      '실행 신호로 running이 투영된 카드는 원본 idle 대신 실행 중 배지를 표시해야 합니다.');
  });

  test('필수 UI 영역과 초보자용 안내 계약이 존재한다', () => {
    const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
    const monitorWorker = fs.readFileSync(path.join(root, 'src', 'monitorWorker.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
    const agentActions = fs.readFileSync(path.join(root, 'renderer', 'app-agent-actions.js'), 'utf8');
    const messages = fs.readFileSync(path.join(root, 'renderer', 'i18n-messages.js'), 'utf8');
    for (const id of REQUIRED_UI_IDS) assert.ok(html.includes(`id="${id}"`));
    for (const id of REMOVED_UI_IDS) {
      assert.equal(html.includes(`id="${id}"`), false, `${id} 삭제 UI가 다시 노출되었습니다.`);
    }
    for (const file of REMOVED_UI_IMPLEMENTATIONS) {
      assert.equal(fs.existsSync(path.join(root, file)), false, `${file} 삭제 UI 구현 파일이 다시 추가되었습니다.`);
    }
    const attentionPopupPlaceholder = fs.readFileSync(path.join(root, 'attention-popup-preload.js'), 'utf8');
    const attentionPopupExecutable = attentionPopupPlaceholder
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .trim();
    assert.equal(attentionPopupExecutable, "'use strict';",
      '패키지 호환 attention popup preload는 API·IPC·실행 코드가 없는 no-op placeholder여야 합니다.');
    assert.doesNotMatch(attentionPopupPlaceholder,
      /\brequire\s*\(|contextBridge|ipcRenderer|exposeInMainWorld|addEventListener|postMessage/u,
      '패키지 호환 placeholder가 삭제된 popup API나 IPC를 다시 노출합니다.');
    const runtimeOverviewCompatibility = fs.readFileSync(
      path.join(root, 'scripts', 'runtime-overview-visual.js'),
      'utf8',
    );
    const runtimeOverviewExecutable = runtimeOverviewCompatibility
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    assert.equal(runtimeOverviewExecutable, "'use strict'; require('./control-room-visual');",
      '과거 runtime visual 명령은 현재 작업 현황 검증만 실행하는 compatibility entry여야 합니다.');
    assert.doesNotMatch(runtimeOverviewCompatibility,
      /automationOverview|runtimeOverview|selectView\s*\(\s*['"]runtime|tmuxSection|tmuxCreateModal/u,
      'compatibility visual entry가 삭제된 추가 기능 runtime/tmux 화면을 긍정 검증합니다.');
    for (const restoredScript of ['app-drawer-data.js', 'app-drawer-content.js']) {
      assert.equal(html.includes(`src="${restoredScript}"`), true, `${restoredScript} 상세 패널 런타임이 로드되지 않습니다.`);
    }
    for (const removedScript of ['drawer-terminal.js', 'app-attention-popup-settings.js']) {
      assert.equal(html.includes(`src="${removedScript}"`), false, `${removedScript} 삭제 화면 런타임이 다시 로드됩니다.`);
    }
    for (const id of RUN_COMPOSER_IDS) assert.ok(html.includes(`id="${id}"`));
    assertIncludesAll(html, BEGINNER_GUIDE_LABELS, label => `${label} 문구가 없습니다.`);
    assertExcludesAll(
      html,
      DISALLOWED_UI_JARGON,
      jargon => `${jargon} 전문 용어가 기본 화면에 남아 있습니다.`,
    );
    assert.ok(
      html.includes('id="runProjectName" class="run-modal-project-name"')
        && !html.includes('id="runProjectLock"')
        && html.includes('id="runCwd" required readonly aria-readonly="true"'),
      '새 작업 창은 현재 프로젝트 이름만 표시하고 작업 경로는 내부에서 변경할 수 없게 고정해야 합니다.',
    );
    assertIncludesAll(
      monitorWorker,
      MONITOR_WORKER_CONTRACTS,
      contract => `${contract} 협업 전송 계약이 없습니다.`,
    );
    assertIncludesAll(appSource, ['const ACTIVITY_STATUS', 'sessionStatusLabel', 'session.activityState']);
    assert.ok(appSource.includes('pendingPromptForSession?.(session) || explicitWaiting'), '터미널·구조화 승인 요청을 대기 중 배지로 우선 표시하지 않습니다.');
    assertIncludesAll(messages, [
      '"ui.agent_thinking": {"ko":"생각 중"',
      '"ui.agent_working": {"ko":"작업 중"',
      '"ui.agent_waiting": {"ko":"대기 중"',
      '"ui.agent_idle": {"ko":"대기"',
    ]);
    assert.ok(monitorWorker.includes('activityState: session.activityState'), 'compact snapshot에 activityState가 전달되지 않습니다.');
    assert.match(
      monitorWorker,
      /session\.status,\r?\n\s+session\.activityState,/,
      'activityState만 바뀐 snapshot을 게시하지 못합니다.',
    );
    assert.match(
      monitorWorker,
      /session\.status,\r?\n\s+session\.activityState,\r?\n\s+completionPresentationFingerprint\(session\),/,
      '완료 표시용 답변만 바뀐 snapshot을 다시 게시하지 못합니다.',
    );
    assert.match(
      monitorWorker,
      /function completionPresentationFingerprint\(session\)[\s\S]*normalizedFingerprintText\(session && session\.result, 1200\)[\s\S]*normalizedFingerprintText\(session && session\.outcome && session\.outcome\.summary, 800\)[\s\S]*normalizedFingerprintText\(latestAssistantText, 420\)/,
      '완료 알림 fingerprint는 제한된 result·outcome·최신 AI 답변만 사용해야 합니다.',
    );
    assert.match(
      monitorWorker,
      /function normalizedFingerprintText\(value, limit\)\s*\{\r?\n\s+return clip\(value, limit\)\.replace\(\/\\s\+\/g, ' '\);/,
      '완료 알림 fingerprint 문구는 크기를 제한하고 공백을 정규화해야 합니다.',
    );
    assert.ok(agentActions.includes('"status", "activityState", "statusDetail"'), '상세 화면이 최신 activityState를 덮어쓰지 못합니다.');
    assert.equal(html.includes('data-view="subagents"'), false);
    assert.equal(html.includes('id="navSubagentCount"'), false);
    assert.equal(html.includes('id="projectContextNav"'), false,
      '빈 추가 기능/프로젝트 탐색 영역은 여백을 남기지 않고 DOM에서 제거되어야 합니다.');
    const sidebarBlock = html.slice(html.indexOf('<aside class="sidebar"'), html.indexOf('<main id="mainContent"'));
    const liveBlock = html.slice(html.indexOf('id="liveSection"'), html.indexOf('id="globalStats"'));
    assert.equal(sidebarBlock.includes('id="workspaceList"'), false, '데스크톱 사이드바에 프로젝트 목록이 다시 들어가면 안 됩니다.');
    assert.ok(sidebarBlock.includes('id="sidebarNewProjectBtn"'), '프로젝트 목록 머리글에 프로젝트 추가 버튼이 없습니다.');
    assert.equal(
      sidebarBlock.slice(sidebarBlock.indexOf('id="sidebarNewProjectBtn"'), sidebarBlock.indexOf('id="projectSidebarList"')).includes('data-open-run'),
      false,
      '왼쪽 프로젝트 추가 버튼이 새 AI 작업 시작 동작과 섞여 있습니다.',
    );
    assert.ok(liveBlock.includes('id="projectTaskToolbar"') && liveBlock.includes('id="newRunBtn"'), '새 AI 작업 버튼은 선택한 프로젝트 영역에 있어야 합니다.');
    assert.ok(liveBlock.includes('id="workspaceList"') && liveBlock.includes('id="addWorkspaceBtn"'), '프로젝트 목록과 추가 버튼이 실행 세션 영역에 없습니다.');
    assert.ok(liveBlock.indexOf('id="workspaceList"') < liveBlock.indexOf('id="addWorkspaceBtn"'), '프로젝트 추가 버튼은 프로젝트 목록 오른쪽 순서에 있어야 합니다.');
    assert.ok(liveBlock.indexOf('id="controlRoomExpandAll"') < liveBlock.indexOf('id="liveSessionGrid"'), '프로젝트 전체 열기·닫기 버튼은 목록 상단에 있어야 합니다.');
    assert.equal(liveBlock.includes('controlRoomPagePrev'), false, '실행 세션 페이징 버튼이 남아 있습니다.');
    const rendererSource = files => files
      .map(file => fs.readFileSync(path.join(root, 'renderer', file), 'utf8'))
      .join('\n');
    const app = rendererSource(APP_MODULES);
    const terminalIntegration = rendererSource([
      'terminal-workbench.js',
      'terminal-agent.js',
      'terminal.js',
      'inline-agent-terminal.js',
    ]);
    assertIncludesAll(
      app,
      APP_PUBLIC_API_CONTRACTS,
      contract => `${contract} 앱 공개 API 계약이 없습니다.`,
    );
    assertIncludesAll(app, APP_READABILITY_CONTRACTS);
    assertIncludesAll(app, APP_AGENT_CONTRACTS);
    assertIncludesAll(
      `${app}\n${terminalIntegration}\n${html}`,
      DRAWER_TERMINAL_CONTRACTS,
      contract => `${contract} 드로어 PTY 계약이 없습니다.`,
    );
    const drawerSource = fs.readFileSync(path.join(root, 'renderer', 'app-drawer.js'), 'utf8');
    const terminalSource = fs.readFileSync(path.join(root, 'renderer', 'terminal.js'), 'utf8');
    const terminalAgentSource = fs.readFileSync(path.join(root, 'renderer', 'terminal-agent.js'), 'utf8');
    const ptyFocusSource = fs.readFileSync(path.join(root, 'renderer', 'app-pty-focus.js'), 'utf8');
    assert.match(drawerSource, /async function openOwnerPty\(id, options = \{\}\)[\s\S]*context\.openPtyFocusVerified\?\.\(root\.id,/u,
      '기존 작업 열기 진입점이 담당 root PTY 집중 모드로 라우팅되어야 합니다.');
    assert.match(drawerSource, /function openSubagentConversation\(id, options = \{\}\)[\s\S]*openDrawerSurface\("modal"\)[\s\S]*renderDrawer\(\)/u,
      '하위 작업은 복원된 오른쪽 상세 패널을 열어야 합니다.');
    assert.match(drawerSource, /function openExecutionActivity\(ownerId, executionId\)[\s\S]*openDrawerSurface\("modal"\)[\s\S]*renderDrawer\(\)/u,
      '실행 항목은 복원된 오른쪽 상세 패널을 열어야 합니다.');
    assert.match(ptyFocusSource, /function openPtyFocusForTerminal\(terminalId, options = \{\}\)[\s\S]*terminalId: id,[\s\S]*creationId:/u,
      '새 AI 작업은 정확한 PTY identity로 집중 모드를 열어야 합니다.');
    for (const restoredId of ['detailDrawer', 'drawerBackdrop', 'drawerTabChat', 'drawerContent']) {
      assert.equal(html.includes(`id="${restoredId}"`), true, `${restoredId} 오른쪽 상세 패널이 누락됐습니다.`);
    }
    assert.equal(html.includes('id="ptyFocusChildModal"'), false,
      '과거의 별도 PTY 하위 팝업 대신 공용 상세 패널을 사용해야 합니다.');
    assert.match(html, /<div id="terminalRuntimeMount" hidden aria-hidden="true"><\/div>/u,
      '실제 xterm host를 옮겨 붙이는 hidden staging mount만 유지해야 합니다.');

    assertIncludesAll(
      app,
      MANAGEMENT_SEMANTIC_CONTRACTS,
      contract => `${contract} 상태·행동 의미 일치 계약이 없습니다.`,
    );
    const managementSource = fs.readFileSync(path.join(root, 'renderer', 'app-management.js'), 'utf8');
    const managementSandbox = {
      window: {
        WhiteboxAppFactories: {},
        WhiteboxI18n: { t: key => key, getLocaleTag: () => 'ko-KR' },
      },
      Intl,
    };
    vm.runInNewContext(managementSource, managementSandbox, { filename: 'app-management.js' });
    const managementState = { snapshot: { sessions: [] }, providers: [], availability: {} };
    const management = managementSandbox.window.WhiteboxAppFactories.createManagement({
      state: managementState,
      esc: value => String(value ?? ''),
      providerInfo: () => ({ label: 'Codex', mark: 'C', accent: '#64cbe5' }),
      timeAgo: () => '방금 전',
      readablePreview: value => ({ text: String(value || ''), full: String(value || '') }),
      isResultReviewComplete: () => false,
      resultReviewTargets: session => session?.id === 'result-contract' ? [session] : [],
    });
    const managementNow = Date.parse('2026-08-06T01:00:00.000Z');
    const managementSession = {
      id: 'attention-contract', status: 'waiting', updatedAt: '2026-08-06T01:00:00.000Z',
      attention: { category: 'required', required: true, kind: 'input', requestedAt: '2026-08-06T01:00:00.000Z' },
      health: { signals: [] },
    };
    assert.equal(management.needsManagementInbox({
      ...managementSession,
      attention: { ...managementSession.attention, source: 'assistant-message' },
    }, managementNow), false, '일반 질문 문장 추정은 확인 필요에 들어가면 안 됩니다.');
    assert.equal(management.needsManagementInbox({
      ...managementSession,
      attention: { ...managementSession.attention, source: 'input-tool' },
    }, managementNow), true, '구조화된 사용자 선택 요청은 확인 필요에 들어가야 합니다.');
    assert.equal(management.needsManagementInbox({
      ...managementSession,
      status: 'running',
      attention: { ...managementSession.attention, kind: 'approval', source: 'execution-approval' },
    }, managementNow), true, '실제 권한 승인 대기는 확인 필요에 들어가야 합니다.');
    assert.equal(management.needsManagementInbox({
      ...managementSession,
      status: 'failed',
      attention: { category: 'risk', kind: 'error', source: 'observed-status' },
      health: { signals: [{ code: 'run-failed', severity: 'critical' }] },
    }, managementNow), false, '실패나 위험 신호만으로 확인 필요에 들어가면 안 됩니다.');
    assert.equal(management.needsManagementInbox({
      ...managementSession,
      id: 'stale-completed-outcome', status: 'failed', pendingResultReview: true,
      outcome: { status: 'completed', verified: true, summary: '이전 완료 결과' },
      attention: { category: 'none', required: false },
    }, managementNow), false, '실패 상태에 남은 과거 완료 outcome을 성공 완료 결과로 다시 표시하면 안 됩니다.');
    const managementResultSession = {
      id: 'result-contract', provider: 'codex', title: '완료 결과 확인 계약',
      status: 'completed', statusDetail: '작업 완료', pendingResultReview: true,
      completedAt: '2026-08-06T01:00:00.000Z', updatedAt: '2026-08-06T01:00:00.000Z',
      attention: { category: 'none', required: false },
      outcome: { status: 'completed', verified: true, summary: '요청한 작업을 모두 마쳤습니다.' },
      health: { level: 'healthy', signals: [] },
      evidence: { confidence: 'high' },
    };
    managementState.snapshot.sessions = [managementResultSession];
    assert.equal(management.needsManagementInbox(managementResultSession, managementNow), true,
      '확인하지 않은 완료 결과는 확인 목록에 표시되어야 합니다.');
    assert.equal(management.needsUserResponse(managementResultSession), false,
      '순수 완료 결과를 실행 흐름을 가리는 답변 대기로 분류하면 안 됩니다.');
    assert.equal(management.needsManagementReview(managementResultSession, managementNow), true,
      '확인하지 않은 완료 결과를 홈 확인 목록에서 누락하면 안 됩니다.');
    assert.equal(management.rootManagementReviews([managementResultSession], managementNow).length, 1,
      '확인하지 않은 완료 결과가 홈 확인 목록에 표시되어야 합니다.');
    const managementResultHtml = management.attentionCardHtml(managementResultSession);
    const completeActionIndex = managementResultHtml.indexOf('data-result-review-complete="result-contract"');
    const detailActionIndex = managementResultHtml.indexOf('data-open-session="result-contract"');
    assert.ok(completeActionIndex >= 0 && completeActionIndex < detailActionIndex,
      '실제 결과 확인 카드의 primary 동작은 상세 열기보다 확인 완료여야 합니다.');
    assert.match(
      managementResultHtml,
      /<button[^>]*data-result-review-complete="result-contract"[^>]*>management\.result_review_complete<\/button>/u,
      '결과 확인 카드의 확인 완료 버튼이 담당 세션 identity를 보존하지 않습니다.',
    );
    assert.equal((managementResultHtml.match(/data-result-review-complete=/g) || []).length, 1,
      '결과 확인 카드에 확인 완료 primary 동작이 중복되면 안 됩니다.');
    assert.doesNotMatch(managementResultHtml, /data-attention-quick=/,
      '결과 확인 카드에 삭제된 대화 빠른 응답 UI를 다시 노출하면 안 됩니다.');
    const operationsStart = managementSource.indexOf('function renderOperationsOverview()');
    const operationsEnd = managementSource.indexOf('\n  function outcomeHtml', operationsStart);
    const operationsSource = managementSource.slice(operationsStart, operationsEnd);
    const homeAttentionRender = operationsSource.indexOf('renderHomeAttention(section)');
    assert.ok(homeAttentionRender >= 0, '선택한 프로젝트 홈이 확인 필요 요약을 렌더링하지 않습니다.');
    assert.doesNotMatch(
      operationsSource.slice(0, homeAttentionRender),
      /section\.classList\.add\(["']hidden["']\)|(?:^|\n)\s*return\s*;/,
      'renderOperationsOverview가 확인 필요 요약을 렌더링하기 전에 무조건 숨기거나 종료하면 안 됩니다.',
    );
    assert.ok(
      operationsSource.includes('document.body.dataset.homeAttentionCount = String(attentionCount)')
        && operationsSource.includes('attentionCount ? "control.home_title_attention" : "control.home_title_clear"'),
      '홈 확인 필요 개수와 제목이 실제 렌더링 결과를 반영해야 합니다.',
    );
    assert.equal(operationsSource.includes('renderProviderUsage('), false, '홈 확인 요약에 제공사 사용량 중복 UI를 다시 넣으면 안 됩니다.');
    assert.ok(html.includes('id="sessionTokenOverview"'), 'AI 사용량은 상단 단일 요약 영역에 있어야 합니다.');
    assert.equal(html.includes('provider-usage-disclosure'), false, '폐기된 홈 제공사 사용량 disclosure가 다시 추가되면 안 됩니다.');
    assert.equal(app.includes('Number(health.score'), false, '검증되지 않은 건강 점수를 UI에 표시하면 안 됩니다.');
    assert.equal(app.includes('agent-focus-layout'), false);
    assert.equal(app.includes("state.view === 'subagents'"), false);
    assert.equal(app.includes('data-session-order-move'), false, '세션 위치 변경용 화살표 버튼 계약이 남아 있습니다.');
    assert.equal(app.includes('data-session-move='), false, '터미널 위치 변경용 화살표 버튼 계약이 남아 있습니다.');
    const styles = STYLE_FILES
      .map(file => fs.readFileSync(path.join(root, 'renderer', file), 'utf8'))
      .join('\n');
    const i18n = fs.readFileSync(path.join(root, 'renderer', 'i18n.js'), 'utf8');
    const i18nMessages = fs.readFileSync(path.join(root, 'renderer', 'i18n-messages.js'), 'utf8');
    assertIncludesAll(
      i18n,
      I18N_RUNTIME_CONTRACTS,
      contract => `${contract} 다국어 런타임 계약이 없습니다.`,
    );
    assertIncludesAll(
      i18nMessages,
      I18N_MESSAGE_CONTRACTS,
      contract => `${contract} 명시 메시지 계약이 없습니다.`,
    );
    assertIncludesAll(
      i18nMessages,
      SEMANTIC_UI_COPY,
      copy => `${copy} 의미 중심 UI 문구가 없습니다.`,
    );
    for (const copy of AMBIGUOUS_KO_MESSAGE_VALUES) {
      assert.equal(
        i18nMessages.includes(`"ko":"${copy}"`),
        false,
        `${copy} 모호한 한국어 UI 문구가 다시 추가되었습니다.`,
      );
    }
    assertExcludesAll(
      i18n,
      LEGACY_I18N_INFERENCE_CONTRACTS,
      legacy => `${legacy} 원문 추론 계약이 남아 있습니다.`,
    );
    const messageReferences = new Set([
      ...[...app.matchAll(/WhiteboxI18n\.t\(["']([^"']+)["']/g)].map(match => match[1]),
      ...[...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map(match => match[1]),
    ]);
    for (const key of messageReferences) {
      assert.ok(
        i18nMessages.includes(`"${key}":`),
        `${key} 메시지 키가 카탈로그에 없습니다.`,
      );
    }
    assert.ok(
      (html.match(/data-i18n(?:-[a-z-]+)?=/g) || []).length >= 150,
      '정적 번역 대상이 명시 키를 충분히 사용하지 않습니다.',
    );
    assert.ok(
      html.indexOf('src="i18n-messages.js"') < html.indexOf('src="i18n.js"'),
      '메시지 카탈로그는 다국어 런타임보다 먼저 로드되어야 합니다.',
    );
    assert.ok(
      html.indexOf('src="i18n.js"') < html.indexOf('src="app.js"'),
      '다국어 런타임은 앱 렌더링보다 먼저 로드되어야 합니다.',
    );
    assert.ok(html.includes('href="styles-bundle.css"'), '명시적 cascade layer 번들이 로드되어야 합니다.');
    const styleBundle = fs.readFileSync(path.join(root, 'renderer', 'styles-bundle.css'), 'utf8');
    STYLE_FILES.slice(1).forEach((style) => {
      assert.ok(styleBundle.includes(`url("${style}")`), `${style} CSS가 명시적 계층 번들에 없습니다.`);
    });
    for (const heading of CSS_RESPONSIBILITY_HEADINGS) {
      assert.ok(styles.includes(heading), `${heading} CSS 책임 경계가 없습니다.`);
    }
    const rendererScripts = [
      'i18n-messages.js',
      'i18n.js',
      'shared.js',
      'ime-submit.js',
      ...APP_MODULES,
      'terminal-workbench.js',
      'terminal-agent.js',
      'terminal-events.js',
      'terminal-prompt.js',
      'terminal.js',
      'inline-agent-terminal.js',
    ];
    rendererScripts.reduce((previous, script) => {
      const index = html.indexOf(`src="${script}"`);
      assert.ok(index > previous, `${script} 렌더러 모듈 로드 순서가 올바르지 않습니다.`);
      return index;
    }, -1);
    assertIncludesAll(
      styles,
      READABILITY_STYLE_CONTRACTS,
      contract => `${contract} 가독성 UI 계약이 없습니다.`,
    );
    assertIncludesAll(
      styles,
      INTERACTION_STYLE_CONTRACTS,
      contract => `${contract} UI 계약이 없습니다.`,
    );
    assertIncludesAll(
      app,
      QUALITY_201_300_APP_CONTRACTS,
      contract => `${contract} 201–300 품질 보강 계약이 없습니다.`,
    );
    assertIncludesAll(
      styles,
      QUALITY_201_300_STYLE_CONTRACTS,
      contract => `${contract} 201–300 품질 스타일 계약이 없습니다.`,
    );
    assertIncludesAll(
      i18nMessages,
      QUALITY_201_300_I18N_CONTRACTS,
      contract => `${contract} 201–300 품질 번역 계약이 없습니다.`,
    );
    assert.doesNotMatch(styles, /\.subagent-(?:coordination|message-preview|work-source)/u,
      '삭제된 도움 AI 대화/미리보기 화면 스타일이 다시 포함되었습니다.');
    assert.doesNotMatch(styles, /\.agent-inline-terminal-composer\s*\{/, '인라인 PTY에 별도 메시지 입력 셸을 다시 만들면 안 됩니다.');
    assert.match(styles, /\.pty-focus-surface/u, '대화창을 대체하는 full PTY 집중 모드 스타일이 없습니다.');
    assert.doesNotMatch(styles, /\.pty-focus-child-modal/u, '삭제된 PTY 하위 노드 팝업 스타일이 다시 포함되었습니다.');
    assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, '동작 줄이기 미디어 계약이 없습니다.');
    const terminal = rendererSource([
      'terminal-workbench.js',
      'terminal-agent.js',
      'terminal-events.js',
      'terminal.js',
    ]);
    assertIncludesAll(terminal, TERMINAL_RUNTIME_CONTRACTS);
    const mainEntry = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
    const ipcSource = IPC_MODULE_FILES
      .map(file => fs.readFileSync(path.join(root, 'src', 'ipc', file), 'utf8'))
      .join('\n');
    assertIncludesAll(
      mainEntry,
      MAIN_PROCESS_CONTRACTS,
      contract => `${contract} 메인 프로세스 계약이 없습니다.`,
    );
    assert.equal(
      (mainEntry.match(/completionFallback:/g) || []).length,
      3,
      '완료 답변이 없을 때 사용할 일반 문구는 지원 언어마다 하나씩 있어야 합니다.',
    );
    assert.match(
      mainEntry,
      /const notificationCopy = event === 'completed'\s*\?\s*\(notificationDetail \|\| mainText\('completionFallback'\)\)\s*:\s*\(notificationDetail \|\| session\.title \|\| '이름 없는 작업'\);/,
      '완료 알림은 사용자 요청 제목을 fallback으로 쓰지 않고 확인 알림만 기존 제목 fallback을 유지해야 합니다.',
    );
    assert.ok(
      mainEntry.includes("const DEFAULT_LOCALE = 'en'")
        && mainEntry.includes('let appLocale = DEFAULT_LOCALE')
        && mainEntry.includes("['ko', 'en', 'zh-CN'].includes(locale) ? locale : DEFAULT_LOCALE"),
      '신규 사용자는 영어로 시작하고 지원되는 기존 언어 선택은 유지되어야 합니다.',
    );
    assert.ok(mainEntry.includes('macPathEntries(os.homedir(), process.env.PATH)'), 'macOS PATH 조회가 검증된 정적 경로 병합기를 사용해야 합니다.');
    assert.ok(!mainEntry.includes('execFileSync(shellPath'), '앱 창 생성 전에 사용자 셸 초기화를 동기 실행하면 안 됩니다.');
    assert.ok(
      mainEntry.includes('const pendingTerminalBindings = new Map()')
        && mainEntry.includes('const existing = pendingTerminalBindings.get(key)')
        && mainEntry.includes('revision !== monitorSnapshotRevision')
        && mainEntry.includes('persistInferredTerminalBindings(message.bridgeBindings).then')
        && mainEntry.includes('message.forkBindingGuardSessionIds || []')
        && mainEntry.includes('snapshotWithoutSessions(message.snapshot, hiddenSessionIds, availability)'),
      'monitor snapshot은 동일 in-flight binding을 기다리고 최신 generation만 게시하며 실패 또는 미검증 fork child 카드만 제외해야 합니다.',
    );
    assert.equal(
      mainEntry.includes('!boundSessionIds.has(sessionId)'),
      false,
      'provisional fork child 가드는 같은 scan의 일반 bridge binding 성공 여부와 무관하게 항상 우선해야 합니다.',
    );
    for (const channel of APP_IPC_CHANNELS) {
      assert.ok(
        ipcSource.includes(`handleTrusted('${channel}'`),
        `${channel} IPC 등록이 없습니다.`,
      );
    }
    for (const channel of TRUSTED_IPC_CHANNELS) {
      assert.ok(ipcSource.includes(`handleTrusted('${channel}'`), `${channel} IPC에 신뢰 발신자 검증이 없습니다.`);
    }
    assert.ok(ipcSource.includes("ipcMain.handle('terminals:write'"), '터미널 입력 IPC 응답 계약이 없습니다.');
    assert.match(
      ipcSource,
      /ipcMain\.handle\('terminals:write',\s*async\s*\(event, id, data, options\)[\s\S]*?\.write\(id, data, options \|\| \{\}\)/,
      '터미널 입력 deliveryId 옵션이 IPC에서 호스트 클라이언트까지 전달되지 않습니다.',
    );
    assert.ok(
      ipcSource.includes('terminalWriteEnvelope: 1')
        && preload.includes('unwrapTerminalWriteEnvelope')
        && preload.includes("['rejected', 'unknown'].includes(details.deliveryState)"),
      '터미널 입력 IPC가 Electron 경계에서 delivery 오류 메타데이터를 보존하지 않습니다.',
    );
    assert.ok(ipcSource.includes("ipcMain.handle('terminals:resize'"), '터미널 크기 변경 IPC 응답 계약이 없습니다.');
    for (const operation of ['detach', 'reconnect', 'stop', 'retire']) {
      assert.ok(
        ipcSource.includes(`ipcMain.handle(\`terminals:\${operation}\``)
          || ipcSource.includes(`'${operation}'`),
        `terminals:${operation} IPC 응답 계약이 없습니다.`,
      );
    }
    assertIncludesAll(
      preload,
      PRELOAD_IPC_CONTRACTS,
      contract => `${contract} 렌더러 IPC 계약이 없습니다.`,
    );
    assert.ok(html.includes('Content-Security-Policy'));
    assert.ok(html.includes('@xterm/xterm/lib/xterm.js'));
    assert.ok(
      html.indexOf('class="topbar"') < html.indexOf('id="beginnerGuide"')
        && html.indexOf('id="beginnerGuide"') < html.indexOf('id="providerOverview"'),
      '시작 가이드는 홈 화면 콘텐츠의 최상단에 있어야 합니다.',
    );
    assert.ok(
      html.indexOf('id="providerOverview"') < html.indexOf('id="updateNotice"'),
      'AI 제공사 요약 카드는 시작 가이드 바로 아래에 있어야 합니다.',
    );
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.build.productName, 'Whitebox');
    assert.equal(pkg.build.executableName, 'Whitebox');
    assert.equal(pkg.build.appId, 'com.wincube.whitebox');
    assert.equal(pkg.build.win.icon, 'build/icon.ico');
    assert.equal(pkg.build.mac.icon, 'build/icon.png');
    assert.ok(pkg.files.includes('build/icon.ico'));
    assert.ok(pkg.build.files.includes('build/icon.ico'));
    assert.equal(pkg.build.portable.unpackDirName, false);
    assert.ok(mainEntry.includes("app.setName(PRODUCT_NAME)"));
    assert.ok(mainEntry.includes('app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)'));
    assert.ok(mainEntry.includes("const BRAND_WINDOWS_ICON_PATH = path.join(__dirname, 'build', 'icon.ico')"));
    assert.ok(mainEntry.includes('icon: brandWindowIcon.isEmpty() ? BRAND_ICON_PATH : brandWindowIcon'));
    assert.ok(mainEntry.includes("typeof mainWindow.setAppDetails === 'function'"));
    assert.ok(mainEntry.includes('appIconPath: app.isPackaged ? process.execPath : BRAND_WINDOWS_ICON_PATH'));
    assert.ok(mainEntry.includes('await registerWindowsShellIdentity({'));
    assert.ok(mainEntry.includes("new Tray(icon)"));
    assert.ok(mainEntry.includes("app.dock.setIcon(sourceDockIcon)"));
    assert.ok(html.includes('id="brandIcon"'));
    assert.ok(html.includes('src="assets/whitebox-mark.svg"'));
    const brandMark = fs.readFileSync(path.join(root, 'renderer', 'assets', 'whitebox-mark.svg'), 'utf8');
    assert.match(brandMark, /<svg[^>]+viewBox="0 0 64 64"/);
    assert.ok(
      mainEntry.includes('WHITEBOX_SOURCE_LAUNCHER=1'),
      '소스 브리지에서 데스크톱 앱을 열 때 Electron 실행 파일과 앱 경로를 함께 전달해야 합니다.',
    );
    assert.ok(pkg.dependencies['node-pty']);
    assert.ok(pkg.dependencies['@xterm/xterm']);
    assert.ok(pkg.dependencies['@xterm/addon-fit']);
    assert.deepStrictEqual(pkg.build.electronLanguages, ['en-US', 'ko', 'zh-CN', 'zh_CN']);
    for (const pattern of [
      '!node_modules/@xterm/xterm/src/**/*',
      '!node_modules/@xterm/xterm/typings/**/*',
      '!node_modules/@xterm/xterm/lib/**/*.map',
      '!node_modules/@xterm/xterm/lib/**/*.mjs',
      '!node_modules/@xterm/addon-fit/src/**/*',
      '!node_modules/@xterm/addon-fit/typings/**/*',
      '!node_modules/@xterm/addon-fit/lib/**/*.map',
      '!node_modules/@xterm/addon-fit/lib/**/*.mjs',
    ]) {
      assert.ok(pkg.build.files.includes(pattern), `패키징 제외 규칙이 없습니다: ${pattern}`);
    }
    assert.equal(pkg.bin.whitebox, 'bin/whitebox.js');
    assert.equal(pkg.scripts['test:runtime-overview'], 'electron scripts/runtime-overview-visual.js',
      'release gate가 참조하는 runtime 호환 점검 진입점을 임의로 바꾸면 안 됩니다.');
    assert.equal(pkg.scripts['test:drawer-conversation'], 'electron scripts/drawer-terminal-visual.js');
    assert.equal(pkg.scripts['test:drawer-actual-pty'], 'node scripts/drawer-actual-pty-runner.js');
    const actualPtyRunner = fs.readFileSync(path.join(root, 'scripts', 'drawer-actual-pty-runner.js'), 'utf8');
    const actualPtyIntegration = fs.readFileSync(path.join(root, 'scripts', 'drawer-actual-pty-integration.js'), 'utf8');
    assert.ok(actualPtyRunner.includes("child.once('exit'"));
    assert.ok(actualPtyRunner.includes('ownedTemporaryRoot(temporary, nonce)'));
    assert.ok(actualPtyRunner.includes('fs.rmSync(exactRoot'));
    assert.ok(actualPtyRunner.includes('process.exitCode = cleanupError'));
    assert.ok(actualPtyIntegration.includes("const codexLaunchArgs = ['fork', codexForkExternalId]"));
    assert.ok(actualPtyIntegration.includes('forkForAgent(source'));
    assert.ok(actualPtyIntegration.includes('client.get(codexForkTerminalId, true)'));
    assert.ok(pkg.build.mac.target.some(item => item.arch.includes('arm64') && item.arch.includes('x64')));
  });

  test('종료된 세션은 최근 기록 위치만 유지하고 실제 상태와 수동 기록 이동을 보존한다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
    const values = new Map();
    const sandbox = {
      localStorage: {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
      },
      document: { documentElement: { dataset: {} } },
      window: {
        WhiteboxAppFactories: {},
        WhiteboxRendererUtils: {
          $: () => null, $$: () => [], esc: value => String(value), uiLocale: () => 'ko',
          providerLabel: value => value, reportRecoverableError: () => {},
        },
        matchMedia: () => ({ matches: false, addEventListener: () => {} }),
        WhiteboxI18n: { t: key => key, observedText: value => value },
      },
    };
    vm.runInNewContext(source, sandbox, { filename: 'app.js' });
    const core = sandbox.window.WhiteboxAppFactories.createCore({});
    const now = Date.parse('2026-07-23T01:00:00.000Z');
    const responseAt = new Date(now - 5 * 60 * 1000).toISOString();
    const ended = { id: 'ended', status: 'completed', messages: [{ role: 'assistant', timestamp: responseAt }] };
    assert.equal(core.isControlRoomSession(ended, now), false);
    const transientActivities = ['thinking', 'working', 'juggling', 'notification'];
    for (const activityState of transientActivities) {
      const transient = {
        id: `generic-${activityState}`,
        status: 'idle',
        activityState,
        updatedAt: new Date(now - 18_000).toISOString(),
        messages: [{ role: 'user', timestamp: new Date(now - 18_000).toISOString() }],
      };
      assert.equal(core.isLiveSession(transient), true, `${activityState} activity가 live 분류에서 빠졌습니다.`);
      assert.equal(core.isControlRoomSession(transient, now), true, `${activityState} activity가 관제에서 빠졌습니다.`);
    }
    assert.equal(core.isLiveSession({ id: 'observed-attention', status: 'idle', activityState: 'attention' }), false);
    assert.equal(core.isLiveSession({ id: 'observed-error', status: 'idle', activityState: 'error' }), false);
    const waitingWithBackground = {
      ...ended,
      id: 'waiting-background',
      status: 'waiting',
      executions: [{ id: 'background-1', status: 'running', mode: 'background' }],
    };
    assert.equal(core.isControlRoomSession(waitingWithBackground, now), true);
    assert.equal(core.controlRoomStatus(waitingWithBackground, now), 'waiting');
    assert.equal(core.isControlRoomSession({ ...ended, status: 'running' }, now), true);
    assert.equal(core.isControlRoomSession(ended, now), true);
    assert.equal(core.controlRoomStatus(ended, now), 'completed');
    assert.equal(
      new Date(core.sessionRetentionDeadline(ended)).toISOString(),
      '2026-07-23T01:25:00.000Z',
      '최근 완료 안내는 남은 분이 아니라 지난 기록 이동 예정 시각을 계산해야 합니다.',
    );
    assert.equal(core.sessionRetentionDeadline({ messages: [{ role: 'assistant' }] }), 0,
      '응답·완료 시각이 없으면 2000년의 잘못된 보존 시각을 만들면 안 됩니다.');
    const graphViewSource = fs.readFileSync(path.join(root, 'renderer', 'app-graph-view.js'), 'utf8');
    const messageSource = fs.readFileSync(path.join(root, 'renderer', 'i18n-messages.js'), 'utf8');
    assert.ok(graphViewSource.includes('control.auto_history_after_time'));
    assert.ok(graphViewSource.includes('timestamp <= 0'), '유효한 보존 시각이 없으면 시계 텍스트를 숨겨야 합니다.');
    assert.equal(graphViewSource.includes('control.auto_history_in_minutes'), false);
    assert.match(messageSource, /"control\.auto_history_after_time": \{"ko":"\{time\} 이후 지난 기록으로 이동"/);
    assert.equal(core.archiveSession(ended), true);
    assert.equal(core.isControlRoomSession(ended, now), false);
    const resumed = {
      ...ended,
      messages: [...ended.messages, { role: 'assistant', timestamp: new Date(now - 60 * 1000).toISOString() }],
    };
    assert.equal(core.isControlRoomSession(resumed, now), true);
    const expired = { ...ended, id: 'expired', messages: [{ role: 'assistant', timestamp: new Date(now - 31 * 60 * 1000).toISOString() }] };
    assert.equal(core.isControlRoomSession({ ...expired, status: 'running' }, now), true);
    assert.equal(core.isControlRoomSession(expired, now), false);
    const child = { ...ended, id: 'child', parentId: 'root', childIds: ['grandchild'] };
    const grandchild = { ...ended, id: 'grandchild', parentId: 'child', status: 'running', activityState: 'working', childIds: [] };
    const rootSession = { ...ended, id: 'root', childIds: ['child'] };
    core.state.snapshot = { sessions: [rootSession, child, grandchild] };
    assert.equal(core.workflowHasActiveDescendant(rootSession), true);
    assert.equal(core.isWorkflowLive(rootSession), true);
    assert.equal(core.controlRoomStatus(rootSession, now), 'running',
      '중첩 서브에이전트가 실행 중이면 완료된 메인 AI를 작업 중으로 표시해야 합니다.');
    assert.equal(core.sessionStatusLabel(rootSession, core.controlRoomStatus(rootSession, now)), 'ui.working',
      '투영된 running 상태를 원본 idle activity가 대기 라벨로 덮으면 안 됩니다.');
    assert.equal(core.isResultReviewCandidate(rootSession), false,
      '하위 작업이 남아 있는 메인 AI의 결과를 완료 확인 대상으로 먼저 노출하면 안 됩니다.');
    assert.equal(core.archiveSession(rootSession), false,
      '하위 작업이 남아 있는 메인 AI를 지난 기록으로 이동하면 안 됩니다.');
    grandchild.status = 'completed';
    grandchild.activityState = 'attention';
    core.state.snapshot = { sessions: [rootSession, child, grandchild] };
    assert.equal(core.isWorkflowLive(rootSession), false);
    assert.equal(core.controlRoomStatus(rootSession, now), 'completed');
    assert.equal(core.isResultReviewCandidate(rootSession), true);
    assert.equal(core.isControlRoomSession({ ...rootSession, status: 'running' }, now), true);
    assert.equal(core.isControlRoomSession({ ...child, status: 'running', activityState: 'working' }, now), true);
    assert.equal(core.archiveSession('root'), true);
    assert.equal(core.isControlRoomSession(child, now), false);
    assert.ok(values.get(core.SESSION_ARCHIVE_STORAGE_KEY));
  });

  test('완료 결과는 확인 stamp를 저장하고 내용이 바뀌면 다시 확인 대상으로 만든다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
    const values = new Map();
    const targetsBySession = new Map();
    const sandbox = {
      localStorage: {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
      },
      document: { documentElement: { dataset: {} } },
      window: {
        WhiteboxAppFactories: {},
        WhiteboxRendererUtils: {
          $: () => null, $$: () => [], esc: value => String(value), uiLocale: () => 'ko',
          providerLabel: value => value, reportRecoverableError: () => {},
          isWritableDirectSession: session => session?.direct === true,
          appOwnedBridgeTerminalIdentity: session => session?.bridgeIdentity || null,
          canForkCodexDesktopSession: session => session?.safeFork === true,
        },
        WhiteboxTerminal: {
          agentTargets: session => targetsBySession.get(session?.id) || [],
        },
        matchMedia: () => ({ matches: false, addEventListener: () => {} }),
        WhiteboxI18n: { t: key => key, observedText: value => value },
      },
    };
    vm.runInNewContext(source, sandbox, { filename: 'app.js' });
    const core = sandbox.window.WhiteboxAppFactories.createCore({});
    const rootSession = {
      id: 'review-root',
      status: 'running',
      direct: true,
      controlCapabilities: { pty: true },
      presentation: { conversationSurface: 'pty' },
      childIds: ['review-result'],
      updatedAt: '2026-07-31T01:00:00.000Z',
    };
    const resultSession = {
      id: 'review-result',
      parentId: rootSession.id,
      childIds: [],
      status: 'completed',
      completedAt: '2026-07-31T01:00:01.000Z',
      updatedAt: '2026-07-31T01:00:01.000Z',
      attention: { category: 'none', required: false },
      outcome: { status: 'completed', verified: true, completedAt: '2026-07-31T01:00:01.000Z', summary: `${'같은 앞부분'.repeat(160)} · 첫 결과` },
    };
    targetsBySession.set(rootSession.id, [{ id: 'terminal-review', terminalId: 'terminal-review', kind: 'terminal' }]);
    core.state.snapshot = { sessions: [rootSession, resultSession] };
    assert.equal(source.includes('const RESULT_REVIEW_REQUIRED = false;'), false,
      '실제 완료 결과 확인 기능을 정적 플래그로 비활성화하면 안 됩니다.');
    assert.deepStrictEqual(Array.from(core.resultReviewTargets(rootSession), session => session.id), ['review-result']);
    const noTarget = { ...rootSession, id: 'review-no-target', childIds: [] };
    const imported = { ...rootSession, id: 'review-imported', sourcePluginId: 'builtin.opencode', childIds: [] };
    const ambiguous = { ...rootSession, id: 'review-ambiguous', childIds: [] };
    const bridge = {
      ...rootSession,
      id: 'review-bridge',
      status: 'completed',
      childIds: [],
      bridgeIdentity: { terminalId: 'terminal-bridge' },
      outcome: { verified: true, completedAt: '2026-07-31T01:00:02.000Z', summary: 'bridge result' },
    };
    const safeFork = {
      ...rootSession,
      id: 'review-safe-fork',
      provider: 'codex',
      clientKind: 'codex-desktop',
      status: 'completed',
      childIds: [],
      safeFork: true,
      attention: { category: 'none', required: false },
      outcome: { verified: true, completedAt: '2026-07-31T01:00:03.000Z', summary: 'safe fork result' },
    };
    const importedSafeFork = { ...safeFork, id: 'review-imported-safe-fork', sourcePluginId: 'builtin.opencode' };
    const readOnlySafeFork = { ...safeFork, id: 'review-read-only-safe-fork', readOnly: true };
    const unsafeFork = { ...safeFork, id: 'review-unsafe-fork', safeFork: false };
    targetsBySession.set(imported.id, [{ id: 'terminal-imported', terminalId: 'terminal-imported', kind: 'terminal' }]);
    targetsBySession.set(ambiguous.id, [
      { id: 'terminal-a', terminalId: 'terminal-a', kind: 'terminal' },
      { id: 'terminal-b', terminalId: 'terminal-b', kind: 'terminal' },
    ]);
    targetsBySession.set(bridge.id, [{ id: 'terminal-wrong', terminalId: 'terminal-wrong', kind: 'terminal' }]);
    core.state.snapshot.sessions.push(
      noTarget, imported, ambiguous, bridge, safeFork, importedSafeFork, readOnlySafeFork, unsafeFork,
    );
    assert.deepStrictEqual(Array.from(core.resultReviewTargets(noTarget)), [],
      'PTY target이 없으면 도달 불가능한 확인 완료 카드를 만들면 안 됩니다.');
    assert.deepStrictEqual(Array.from(core.resultReviewTargets(imported)), [],
      'imported/source-plugin 기록은 writable PTY 결과로 취급하면 안 됩니다.');
    assert.deepStrictEqual(Array.from(core.resultReviewTargets(ambiguous)), [],
      'direct 세션의 terminal target이 여러 개면 임의 PTY로 결과 확인을 라우팅하면 안 됩니다.');
    assert.deepStrictEqual(Array.from(core.resultReviewTargets(bridge)), [],
      'app-owned bridge는 runtime terminalId와 다른 target을 허용하면 안 됩니다.');
    assert.deepStrictEqual(Array.from(core.resultReviewTargets(safeFork)), [],
      '기본 의미 조회는 아직 생성되지 않은 PTY를 존재하는 exact target처럼 취급하면 안 됩니다.');
    assert.deepStrictEqual(
      Array.from(core.resultReviewTargets(safeFork, { allowPtyCreation: true }), session => session.id),
      ['review-safe-fork'],
      '완료된 Codex Desktop은 명시적 확인 동작에서만 safe fork PTY를 만들 수 있어야 합니다.',
    );
    assert.deepStrictEqual(Array.from(core.resultReviewTargets(importedSafeFork, { allowPtyCreation: true })), [],
      'imported/source-plugin 결과는 safe fork 판정이 있어도 확인 완료 PTY를 만들면 안 됩니다.');
    assert.deepStrictEqual(Array.from(core.resultReviewTargets(readOnlySafeFork, { allowPtyCreation: true })), [],
      'read-only 결과는 safe fork 판정이 있어도 확인 완료 PTY를 만들면 안 됩니다.');
    assert.deepStrictEqual(Array.from(core.resultReviewTargets(unsafeFork, { allowPtyCreation: true })), [],
      '안전한 생성 경로가 없는 완료 세션에는 확인 완료 버튼을 노출하면 안 됩니다.');
    targetsBySession.set(bridge.id, [
      { id: 'terminal-decoy', terminalId: 'terminal-decoy', kind: 'terminal' },
      { id: 'terminal-bridge', terminalId: 'terminal-bridge', kind: 'terminal' },
    ]);
    assert.equal(core.resultReviewPtyTarget(bridge)?.terminalId, 'terminal-bridge',
      'bridge root에 decoy가 함께 있어도 runtime identity와 일치하는 exact PTY를 골라야 합니다.');
    assert.deepStrictEqual(Array.from(core.resultReviewTargets(bridge), session => session.id), ['review-bridge'],
      'app-owned bridge의 exact runtime terminal target만 확인 완료 카드에 도달해야 합니다.');
    const firstStamp = core.resultReviewStamp(resultSession);
    assert.ok(firstStamp);
    assert.equal(core.markResultReviewComplete(rootSession), 1);
    assert.equal(core.isResultReviewComplete(resultSession), true);
    assert.ok(values.has(core.RESULT_REVIEW_STORAGE_KEY),
      'verified PTY에서 확인한 완료 결과 stamp를 저장해야 합니다.');

    const reloaded = sandbox.window.WhiteboxAppFactories.createCore({});
    reloaded.state.snapshot = core.state.snapshot;
    assert.equal(reloaded.isResultReviewComplete(resultSession), true,
      '저장한 완료 결과 stamp는 reload 뒤에도 유지되어야 합니다.');
    const bootstrapSource = fs.readFileSync(path.join(root, 'renderer', 'app-bootstrap.js'), 'utf8');
    const sessionRenderSource = fs.readFileSync(path.join(root, 'renderer', 'app-session-render.js'), 'utf8');
    assert.match(sessionRenderSource,
      /resultReviewTargets\(session, \{ allowPtyCreation: true \}\)\.length > 0/u,
      '삭제된 확인 전용 페이지 대신 지난 기록 카드가 안전한 PTY 결과 확인 대상을 판정해야 합니다.');
    assert.ok(sessionRenderSource.includes('data-result-review="true"')
      && sessionRenderSource.includes('t("studio.review.open_result")'),
    '지난 기록의 완료 카드는 담당 PTY 결과 확인 동작을 명확히 노출해야 합니다.');
    assert.ok(sessionRenderSource.includes('t("memory.recorded_decisions")')
      && sessionRenderSource.includes('t(`memory.stage_decision_${decisionState}`)')
      && !sessionRenderSource.includes('memory.no_result_to_review'),
    '지난 기록의 5단계와 지표는 결과 열람 여부가 아니라 실제 사용자 결정을 표시해야 합니다.');
    assert.equal(bootstrapSource.includes("{ tab: 'summary', resultReview: true }"), false,
      '완료 알림을 열 때 결과 확인 상태를 자동 저장하면 안 됩니다.');
    assert.ok(bootstrapSource.indexOf('window.whitebox.onUpdateState')
      < bootstrapSource.indexOf('window.WhiteboxRendererUtils.bootstrap()'),
    '시작 중 업데이트 상태 변경을 놓치지 않도록 bootstrap 전에 구독해야 합니다.');
    assert.match(bootstrapSource, /state\.update = latestUpdateState \|\| bootstrap\.update/,
      'bootstrap 도중 도착한 최신 업데이트 상태를 초기 스냅샷보다 우선해야 합니다.');
    assert.match(bootstrapSource, /addEventListener\("whitebox:terminal-inventory-changed"[\s\S]*render\("terminal-inventory"\)/,
      'PTY inventory가 늦게 도착하면 exact target 기반 결과 확인 카드를 다시 렌더링해야 합니다.');
    const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    assert.match(mainSource, /if \(updateManager\) sendUpdateState\(updateManager\.getState\(\)\)/,
      'renderer ready 시 최신 업데이트 상태를 한 번 더 보내 이벤트 경합을 닫아야 합니다.');

    resultSession.outcome = { ...resultSession.outcome, summary: '새 완료 결과' };
    assert.notEqual(core.resultReviewStamp(resultSession), firstStamp,
      '완료 결과 내용이 달라지면 review stamp도 달라져야 합니다.');
    assert.equal(core.isResultReviewComplete(resultSession), false);
    assert.deepStrictEqual(Array.from(core.resultReviewTargets(rootSession), session => session.id), ['review-result'],
      '새 완료 결과 stamp는 다시 확인 대상으로 나타나야 합니다.');
  });

  test('프로젝트 알림 확인은 현재 신호만 숨기고 새 결과와 새 요청을 다시 표시한다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
    const values = new Map();
    const targetsBySession = new Map();
    const sandbox = {
      localStorage: {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
      },
      document: { documentElement: { dataset: {} } },
      window: {
        WhiteboxAppFactories: {},
        WhiteboxRendererUtils: {
          $: () => null, $$: () => [], esc: value => String(value), uiLocale: () => 'ko',
          providerLabel: value => value, reportRecoverableError: () => {},
          isWritableDirectSession: session => session?.direct === true,
          appOwnedBridgeTerminalIdentity: session => session?.bridgeIdentity || null,
        },
        WhiteboxTerminal: {
          agentTargets: session => targetsBySession.get(session?.id) || [],
        },
        matchMedia: () => ({ matches: false, addEventListener: () => {} }),
        WhiteboxI18n: { t: key => key, observedText: value => value },
      },
    };
    vm.runInNewContext(source, sandbox, { filename: 'app.js' });
    const core = sandbox.window.WhiteboxAppFactories.createCore({});
    const result = {
      id: 'notice-result', status: 'completed', updatedAt: '2026-08-12T01:00:00.000Z',
      direct: true, controlCapabilities: { pty: true }, presentation: { conversationSurface: 'pty' },
      completionObserved: true, messages: [], attention: { category: 'none', required: false },
      outcome: { verified: true, completedAt: '2026-08-12T01:00:00.000Z', summary: '첫 완료 결과' },
    };
    const attention = {
      id: 'notice-attention', status: 'waiting', updatedAt: '2026-08-12T01:01:00.000Z', messages: [],
      attention: {
        category: 'required', required: true, kind: 'input', source: 'input-tool',
        requestId: 'request-a|request-b', requestedAt: '2026-08-12T01:01:00.000Z', summary: '환경을 고르세요.',
      },
    };
    targetsBySession.set(result.id, [{ id: 'terminal-notice', terminalId: 'terminal-notice', kind: 'terminal' }]);
    core.state.snapshot = { sessions: [result, attention] };

    assert.equal(core.isProjectNoticeSeen('result', result), false);
    assert.equal(core.markProjectNoticeSeen('result', result), true);
    assert.equal(core.isProjectNoticeSeen('result', result), true);
    assert.equal(core.isResultReviewComplete(result), false,
      '프로젝트 배지를 본 것만으로 완료 결과 확인이 끝나면 안 됩니다.');
    assert.deepStrictEqual(Array.from(core.resultReviewTargets(result), session => session.id), ['notice-result']);
    assert.ok(values.get(core.PROJECT_NOTICE_ACK_STORAGE_KEY));

    const reloaded = sandbox.window.WhiteboxAppFactories.createCore({});
    reloaded.state.snapshot = core.state.snapshot;
    assert.equal(reloaded.isProjectNoticeSeen('result', result), true, '프로젝트 알림 열람 상태가 재시작 후 유지되어야 합니다.');
    assert.equal(reloaded.markResultReviewComplete(result), 1);
    assert.equal(reloaded.isResultReviewComplete(result), true);
    assert.deepStrictEqual(Array.from(reloaded.resultReviewTargets(result)), []);
    result.outcome = { ...result.outcome, summary: '새 완료 결과' };
    assert.equal(reloaded.isProjectNoticeSeen('result', result), false, '새 결과 내용은 다시 프로젝트에 표시해야 합니다.');
    assert.equal(reloaded.isResultReviewComplete(result), false,
      '새 결과 내용은 저장된 이전 review stamp와 일치하면 안 됩니다.');
    assert.deepStrictEqual(Array.from(reloaded.resultReviewTargets(result), session => session.id), ['notice-result'],
      '새 결과 stamp는 확인 목록에도 다시 나타나야 합니다.');

    assert.equal(core.markProjectNoticeSeen('attention', attention), true);
    assert.equal(core.isProjectNoticeSeen('attention', attention), true);
    attention.updatedAt = '2026-08-12T01:02:00.000Z';
    attention.attention = { ...attention.attention, summary: '환경을 지금 고르세요.' };
    assert.equal(core.isProjectNoticeSeen('attention', attention), true,
      '같은 requestId의 문구나 갱신 시각 변화만으로 프로젝트 알림이 되살아나면 안 됩니다.');
    attention.attention = { ...attention.attention, requestId: 'request-b' };
    assert.equal(core.isProjectNoticeSeen('attention', attention), true,
      '함께 확인한 요청 중 하나가 해결되어도 남은 기존 요청을 새 알림처럼 표시하면 안 됩니다.');
    attention.attention = { ...attention.attention, requestId: 'request-b|request-c' };
    assert.equal(core.isProjectNoticeSeen('attention', attention), false, '새 요청 ID만 다시 프로젝트에 표시해야 합니다.');

    const firstPrompt = { fingerprint: 'prompt-a', target: { id: 'terminal-a' } };
    assert.equal(core.markProjectNoticeSeen('terminal', attention, firstPrompt), true);
    assert.equal(core.isProjectNoticeSeen('terminal', attention, firstPrompt), true);
    assert.equal(core.isProjectNoticeSeen('terminal', attention, { ...firstPrompt, fingerprint: 'prompt-b' }), false,
      '새 PTY 승인 요청은 다시 프로젝트에 표시해야 합니다.');
  });


  test('지난 기록 상세 화면은 전체 대화는 보존하고 최신 대기 상태를 우선한다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-agent-actions.js'), 'utf8');
    const sandbox = {
      window: {
        WhiteboxAppFactories: {},
        WhiteboxI18n: { t: key => key, errorText: error => String(error) },
      },
    };
    vm.runInNewContext(source, sandbox, { filename: 'app-agent-actions.js' });
    const detailMessages = [{ id: 'message-1', role: 'assistant', text: '완료된 답변' }];
    const staleDetail = {
      id: 'history-session',
      status: 'running',
      statusDetail: '작업 진행 중',
      updatedAt: '2026-08-03T01:00:00.000Z',
      messages: detailMessages,
      lifecycle: [{ id: 'turn-1', status: 'running' }],
      executions: [{ id: 'shell-1', status: 'running' }],
    };
    const latestSnapshot = {
      id: staleDetail.id,
      status: 'idle',
      statusDetail: '다음 요청 대기',
      updatedAt: '2026-08-03T01:01:00.000Z',
      completionObserved: true,
      executions: [{ id: 'shell-1', status: 'completed' }],
    };
    const state = {
      selectedId: staleDetail.id,
      details: new Map([[staleDetail.id, staleDetail]]),
      snapshot: { sessions: [latestSnapshot] },
    };
    const actions = sandbox.window.WhiteboxAppFactories.createAgentActions({ state });
    const selected = actions.selectedSession();

    assert.equal(selected.status, 'idle');
    assert.equal(selected.statusDetail, '다음 요청 대기');
    assert.equal(selected.executions[0].status, 'completed');
    assert.strictEqual(selected.messages, detailMessages);
    assert.strictEqual(selected.lifecycle, staleDetail.lifecycle);
  });

  test('오른쪽 상세 패널은 보정 조회 중 도착한 최신 snapshot까지 따라잡는다', async () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-drawer-data.js'), 'utf8');
    const pending = [];
    const deferred = () => {
      let resolve;
      const promise = new Promise(next => { resolve = next; });
      return { promise, resolve };
    };
    const sandbox = {
      window: {
        WhiteboxAppFactories: {},
        WhiteboxI18n: { t: key => key, errorText: error => String(error) },
        whitebox: {
          sessionDetail: () => {
            const request = deferred();
            pending.push(request);
            return request.promise;
          },
        },
      },
    };
    vm.runInNewContext(source, sandbox, { filename: 'app-drawer-data.js' });
    const sessionId = 'drawer-live-session';
    let renderCount = 0;
    const state = {
      snapshot: { sessions: [{ id: sessionId, updatedAt: 'v1' }] },
      details: new Map(),
      detailErrors: new Map(),
      detailLoadingIds: new Set(),
      selectedId: sessionId,
      drawerTab: 'chat',
      drawerForceLatest: false,
    };
    const drawerData = sandbox.window.WhiteboxAppFactories.createDrawerData({
      state,
      renderDrawer() { renderCount += 1; },
      renderPtyFocusDetail() {},
      reportRecoverableError(error) { throw error; },
    });

    const first = drawerData.loadSessionDetail(sessionId, true, 'v1');
    await Promise.resolve();
    assert.equal(pending.length, 1);
    drawerData.loadSessionDetail(sessionId, true, 'v2');
    pending[0].resolve({ id: sessionId, updatedAt: 'v1' });
    await first;
    while (pending.length < 2) await Promise.resolve();

    const second = drawerData.loadSessionDetail(sessionId, true, 'v3');
    pending[1].resolve({ id: sessionId, updatedAt: 'v2' });
    await second;
    while (pending.length < 3) await Promise.resolve();
    pending[2].resolve({ id: sessionId, updatedAt: 'v3' });
    while (state.details.get(sessionId)?.updatedAt !== 'v3') await Promise.resolve();

    assert.equal(pending.length, 3,
      '보정 조회 중 더 최신 snapshot이 오면 최신 버전 하나를 추가 조회해야 합니다.');
    assert.equal(state.detailLoadingIds.size, 0);

    const parentId = 'drawer-parent-session';
    state.snapshot.sessions = [
      { id: parentId, updatedAt: 'parent-v2' },
      { id: sessionId, parentId, updatedAt: 'child-v1' },
    ];
    state.selectedId = sessionId;
    state.drawerMode = 'subagent';
    const rendersBeforeParent = renderCount;
    const parentRequest = drawerData.loadSessionDetail(parentId, true, 'parent-v2');
    await Promise.resolve();
    pending[3].resolve({ id: parentId, updatedAt: 'parent-v2', collaboration: { communications: ['new'] } });
    await parentRequest;
    assert.equal(state.details.get(parentId)?.updatedAt, 'parent-v2');
    assert.ok(renderCount > rendersBeforeParent,
      '선택한 하위 작업의 부모 detail이 갱신되면 열린 coordination 패널도 다시 그려야 합니다.');

    const bootstrapSource = fs.readFileSync(path.join(root, 'renderer', 'app-bootstrap.js'), 'utf8');
    assert.match(bootstrapSource,
      /card\?\.parentId[\s\S]*parentCard[\s\S]*parentCard\.updatedAt !== parentDetail\.updatedAt[\s\S]*loadSessionDetail\(card\.parentId, true, parentCard\.updatedAt\)/u,
      '열린 하위·실행 drawer는 부모 snapshot 버전이 바뀌면 부모 전체 detail도 갱신해야 합니다.');
  });

  test('루트 작업은 PTY 집중 모드로, 하위 작업은 오른쪽 상세 패널로 연다', async () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-drawer.js'), 'utf8');
    const sandbox = {
      CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
      window: {
        WhiteboxAppFactories: {},
        WhiteboxI18n: { t: key => key },
        addEventListener: () => {},
        dispatchEvent: () => {},
      },
    };
    vm.runInNewContext(source, sandbox, { filename: 'app-drawer.js' });
    const parent = { id: 'root', provider: 'codex' };
    const child = { id: 'child', parentId: parent.id, provider: 'codex' };
    const sessions = new Map([[parent.id, parent], [child.id, child]]);
    const opened = [];
    const reviewed = [];
    const state = { details: new Map(), selectedId: '' };
    const routerContext = {
      state,
      snapshotSession: id => sessions.get(id) || null,
      canOpenPtyFocus: session => session === parent,
      resultReviewPtyTarget: session => session === parent
        ? { id: 'terminal-root', terminalId: 'terminal-root' }
        : null,
      resultReviewTargets: session => session === parent ? [parent] : [],
      resultReviewStamp: session => `stamp:${session.id}`,
      markResultReviewComplete: (session, options) => {
        reviewed.push([session.id, options]);
        return 1;
      },
      markGuideStep: () => {},
      signalManualTerminalSelection: () => {},
      openPtyFocusVerified: async (id, options) => {
        opened.push([id, options.focus, options.targetId, options.terminalId]);
        return { opened: true };
      },
    };
    const drawer = sandbox.window.WhiteboxAppFactories.createDrawer(routerContext);

    assert.match(source, /function openSubagentConversation\(id, options = \{\}\)[\s\S]*state\.selectedId = id;[\s\S]*openDrawerSurface\("modal"\);[\s\S]*renderDrawer\(\);/u,
      '하위 작업은 담당 root PTY로 전환하지 말고 상세 패널에 해당 대화를 보여야 합니다.');
    assert.match(source, /function openExecutionActivity\(ownerId, executionId\)[\s\S]*state\.drawerMode = "execution";[\s\S]*openDrawerSurface\("modal"\);[\s\S]*renderDrawer\(\);/u,
      '실행 항목도 공용 오른쪽 상세 패널에서 열려야 합니다.');
    assert.equal(await drawer.openDrawer(parent.id, { focus: true, resultReview: true }), true);
    assert.deepStrictEqual(opened, [[parent.id, true, 'terminal-root', 'terminal-root']]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(reviewed)), [[parent.id, {
      expectedTargets: [{ id: parent.id, stamp: `stamp:${parent.id}` }],
    }]], 'PTY open 전에 캡처한 동일 결과 stamp만 확인 완료로 저장해야 합니다.');
    assert.equal(state.selectedId, parent.id, '루트 PTY 진입은 열린 루트 선택을 보존해야 합니다.');

    let resolveStale;
    let activeFocus = false;
    const staleRoot = { id: 'stale-root', provider: 'codex' };
    const currentRoot = { id: 'current-root', provider: 'codex' };
    const raceSessions = new Map([
      [staleRoot.id, staleRoot], [currentRoot.id, currentRoot],
    ]);
    const viewFallbacks = [];
    const fallbackToasts = [];
    const acknowledgements = [];
    const raceState = { details: new Map(), selectedId: '' };
    const raceDrawer = sandbox.window.WhiteboxAppFactories.createDrawer({
      state: raceState,
      snapshotSession: id => raceSessions.get(id) || null,
      markGuideStep: () => {},
      signalManualTerminalSelection: () => {},
      canOpenPtyFocus: () => true,
      resultReviewPtyTarget: session => ({ id: `terminal-${session.id}`, terminalId: `terminal-${session.id}` }),
      isPtyFocusActive: () => activeFocus,
      openPtyFocusVerified: (id, options) => {
        if (id === staleRoot.id) {
          return new Promise(resolve => { resolveStale = () => resolve({ opened: false }); });
        }
        activeFocus = true;
        assert.equal(options.isCurrent(), true, '가장 최근 PTY open generation은 current여야 합니다.');
        return Promise.resolve({ opened: true });
      },
      acknowledgeSessionNotices: session => { acknowledgements.push(session.id); return 1; },
      selectView: view => viewFallbacks.push(view),
      toast: message => fallbackToasts.push(message),
    });
    const staleOpen = raceDrawer.openDrawer(staleRoot.id, { focus: true });
    await Promise.resolve();
    assert.equal(typeof resolveStale, 'function');
    assert.equal(await raceDrawer.openDrawer(currentRoot.id, { focus: true }), true);
    resolveStale();
    assert.equal(await staleOpen, false);
    assert.deepStrictEqual(viewFallbacks, [],
      '늦게 실패한 A open이 현재 B PTY를 작업 현황 fallback으로 덮으면 안 됩니다.');
    assert.deepStrictEqual(fallbackToasts, [], '취소된 A open이 B 위에 실패 toast를 띄우면 안 됩니다.');
    assert.deepStrictEqual(acknowledgements, [currentRoot.id],
      'stale A 알림은 확인 처리하지 않고 verified B만 처리해야 합니다.');
    assert.equal(raceState.selectedId, currentRoot.id);
  });

  test('legacy attention과 prompt의 늦은 실패는 사용자가 연 다른 PTY를 덮지 않는다', async () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-bootstrap.js'), 'utf8');
    const deferred = () => {
      let resolve;
      const promise = new Promise(next => { resolve = next; });
      return { promise, resolve };
    };
    const classList = () => {
      const values = new Set();
      return {
        add: (...items) => items.forEach(item => values.add(item)),
        remove: (...items) => items.forEach(item => values.delete(item)),
        contains: item => values.has(item),
      };
    };
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) {
        const nested = { textContent: '', removeAttribute() {} };
        elements.set(id, {
          id,
          classList: classList(),
          hidden: false,
          inert: false,
          textContent: '',
          addEventListener() {},
          removeAttribute() {},
          setAttribute() {},
          querySelector: () => nested,
          scrollTo() {},
        });
      }
      return elements.get(id);
    };
    const windowEvents = new Map();
    const attentionHandlers = [];
    const promptHandlers = [];
    const openCalls = [];
    const viewFallbacks = [];
    const fallbackToasts = [];
    const closeCalls = [];
    let activeFocus = false;
    let promptResolution = null;
    const state = {
      providers: [],
      hiddenProviders: new Set(),
      details: new Map(),
      sourcePluginSettings: {},
      snapshot: null,
      ptyFocusSessionId: '',
    };
    const additions = {
      $: selector => element(String(selector).replace(/^#/, '')),
      esc: value => String(value),
      state,
      loadGuideState() {},
      loadQualityState() {},
      saveDashboardPreferences() {},
      loadProviderVisibility() {},
      projectVisibleSnapshot: snapshot => snapshot,
      visibleSnapshot: () => state.snapshot,
      isProviderVisible: () => true,
      bindEvents() {},
      render() {},
      timeOnly: value => value,
      renderUpdateSettings() {},
      syncViewChrome() {},
      selectView: view => viewFallbacks.push(view),
      canOpenPtyFocus: () => true,
      isPtyFocusActive: () => activeFocus,
      ownerRootSession: session => session,
      openPtyFocusVerified: (sessionId, options) => {
        const pending = deferred();
        openCalls.push({ sessionId, options, pending });
        return pending.promise;
      },
      closePtyFocus: options => closeCalls.push(options),
      syncPendingPtyFocus() {},
      toast: message => fallbackToasts.push(message),
      refreshProviderUsage: async () => null,
    };
    const factoryNames = [
      'createCore', 'createProviderVisibility', 'createDashboard',
      'createGraphModel', 'createGraphView', 'createGraphLayout', 'createGraphOrchestration',
      'createAgentActions', 'createManagement', 'createSessionRenderer',
      'createDrawerData', 'createDrawerContent', 'createPtyFocusMode', 'createDrawer',
      'createRunModal', 'createQualityEnhancements',
      'createNavigationEventBindings', 'createSessionEventBindings', 'createFilterEventBindings',
      'createDialogEventBindings', 'createEventBindings',
    ];
    const factories = Object.fromEntries(factoryNames.map(name => [
      name,
      () => name === 'createCore' ? additions : {},
    ]));
    const bootstrapSnapshot = {
      generatedAt: '2026-09-02T00:00:00.000Z',
      sessions: [
        { id: 'passive-a', provider: 'codex', parentId: null },
        { id: 'manual-b', provider: 'codex', parentId: null },
      ],
    };
    const whitebox = {
      onUpdateState() {},
      setLocale: async () => {},
      onAttentionRequested: callback => attentionHandlers.push(callback),
      onTerminalPromptResolved: callback => promptHandlers.push(callback),
      onMonitorError() {},
      onSnapshot() {},
      rendererReady: async () => {},
    };
    const sandbox = {
      console,
      CustomEvent: class CustomEvent {},
      document: {
        documentElement: { dataset: {} },
        querySelector: selector => element(selector),
      },
      navigator: { clipboard: { writeText: async () => {} } },
      requestAnimationFrame: callback => { callback(); return 1; },
      setTimeout,
      window: {
        WhiteboxAppFactories: factories,
        WhiteboxI18n: {
          t: key => key,
          errorText: error => String(error),
          getLocale: () => 'ko',
        },
        WhiteboxRendererUtils: {
          bootstrap: async () => ({
            providers: [{ id: 'codex' }],
            availability: { codex: true },
            sourcePlugins: [],
            workspaces: [],
            snapshot: bootstrapSnapshot,
            activeRuns: [],
            platform: 'win32',
            versions: {},
            update: { status: 'idle' },
          }),
          reportRecoverableError() {},
        },
        WhiteboxTerminal: {
          resolveAttentionPrompt: () => promptResolution,
        },
        whitebox,
        location: { reload() {} },
        addEventListener(type, listener) {
          if (!windowEvents.has(type)) windowEvents.set(type, []);
          windowEvents.get(type).push(listener);
        },
      },
    };
    vm.runInNewContext(source, sandbox, { filename: 'app-bootstrap-focus-steal.js' });
    for (let attempt = 0; attempt < 10 && !sandbox.window.WhiteboxApp.initialized; attempt += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(sandbox.window.WhiteboxApp.initialized, true);
    assert.equal(attentionHandlers.length, 1);
    assert.equal(promptHandlers.length, 1);
    const manualSelection = windowEvents.get('whitebox:terminal-manual-selection')?.[0];
    assert.equal(typeof manualSelection, 'function');

    const legacyPending = attentionHandlers[0]({ sessionId: 'passive-a', event: 'completed' });
    await Promise.resolve();
    assert.equal(openCalls[0].sessionId, 'passive-a');
    assert.equal(openCalls[0].options.isCurrent(), true);
    state.ptyFocusSessionId = 'manual-b';
    activeFocus = true;
    manualSelection();
    assert.equal(openCalls[0].options.isCurrent(), false);
    openCalls[0].pending.resolve({ opened: false });
    await legacyPending;
    assert.deepStrictEqual(viewFallbacks, [],
      '늦은 legacy attention 실패가 사용자의 B PTY를 waiting/active 화면으로 덮으면 안 됩니다.');
    assert.deepStrictEqual(fallbackToasts, [], '취소된 legacy attention이 B 위에 실패 toast를 띄우면 안 됩니다.');
    assert.deepStrictEqual(closeCalls, [], 'legacy attention fallback이 다른 owner의 B PTY를 닫으면 안 됩니다.');

    activeFocus = false;
    state.ptyFocusSessionId = '';
    promptResolution = {
      ok: true,
      requiresText: true,
      sessionId: 'passive-a',
      targetId: 'terminal-a',
      terminalId: 'terminal-a',
    };
    const promptPending = promptHandlers[0]({ requestId: 'prompt-a' });
    await Promise.resolve();
    assert.equal(openCalls[1].sessionId, 'passive-a');
    assert.equal(openCalls[1].options.targetId, 'terminal-a');
    state.ptyFocusSessionId = 'manual-b';
    activeFocus = true;
    manualSelection();
    assert.equal(openCalls[1].options.isCurrent(), false);
    openCalls[1].pending.resolve({ opened: false });
    await promptPending;
    assert.deepStrictEqual(viewFallbacks, []);
    assert.deepStrictEqual(fallbackToasts, []);
    assert.deepStrictEqual(closeCalls, []);
  });

  test('새 작업 PTY 집중 대상은 terminalId와 creationId가 정확히 같은 root 하나만 고른다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-pty-focus.js'), 'utf8');
    const instrumented = source
      .replace(
        /return \{\r?\n    canOpenPtyFocus,/u,
        'return {\n    sessionForTerminal,\n    canOpenPtyFocus,',
      )
      .replace(
        /    pendingFocus = null;\r?\n    const root = ownerRootSession\(sessionId\);/u,
        '    pendingFocus = null;\n    if (context.__openSpy) { context.__openSpy(sessionId); state.ptyFocusSessionId = sessionId; return true; }\n    const root = ownerRootSession(sessionId);',
      );
    assert.notEqual(instrumented, source, 'PTY identity harness가 실제 구현을 노출하지 못했습니다.');
    assert.ok(instrumented.includes('context.__openSpy'),
      '일반 PTY open이 이전 pending create focus를 취소하는 지점을 찾지 못했습니다.');
    const bridge = (id, creationId, parentId = '') => ({
      id: `bridge:${id}:${creationId}`,
      parentId,
      provider: 'codex',
      source: 'whitebox-bridge',
      clientKind: 'whitebox-bridge',
      runtimePresence: [{ kind: 'bridge', terminalId: id, creationId, provider: 'codex' }],
    });
    const state = { snapshot: { sessions: [
      bridge('terminal:new', 'create-good'),
      bridge('terminal:new', 'create-other'),
      bridge('terminal:child-only', 'create-child', 'parent'),
    ] } };
    const eventListeners = new Map();
    const sandbox = {
      Date, Map, Promise, Set,
      CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
      window: {
        WhiteboxAppFactories: {},
        WhiteboxI18n: { t: key => key },
        WhiteboxRendererUtils: {
          appOwnedBridgeTerminalIdentity: session => session.runtimePresence?.[0] || null,
        },
        addEventListener(type, listener) {
          if (!eventListeners.has(type)) eventListeners.set(type, []);
          eventListeners.get(type).push(listener);
        },
        dispatchEvent(event) {
          (eventListeners.get(event.type) || []).forEach(listener => listener(event));
        },
      },
    };
    vm.runInNewContext(instrumented, sandbox, { filename: 'app-pty-focus.js' });
    const opened = [];
    const focus = sandbox.window.WhiteboxAppFactories.createPtyFocusMode({
      state,
      $: () => null,
      __openSpy: id => opened.push(id),
    });

    assert.equal(focus.sessionForTerminal('terminal:new', 'create-good').id, 'bridge:terminal:new:create-good');
    assert.equal(focus.sessionForTerminal('terminal:new', ''), null,
      'creationId 없이 같은 terminalId 후보가 둘이면 추측해서 열면 안 됩니다.');
    assert.equal(focus.sessionForTerminal('terminal:new', 'missing'), null);
    assert.equal(focus.sessionForTerminal('terminal:child-only', 'create-child'), null,
      '하위 작업 projection은 새 작업 PTY 집중 대상으로 선택하면 안 됩니다.');
    assert.match(source, /pendingFocus = \{[\s\S]*terminalId: id,[\s\S]*creationId:/u,
      'snapshot 전에 요청한 새 PTY의 exact identity를 대기 상태로 보존해야 합니다.');

    state.snapshot.sessions = [{ id: 'manual-b', provider: 'codex' }];
    assert.equal(focus.openPtyFocusForTerminal('terminal:late-a', { creationId: 'create-a' }), false);
    assert.equal(focus.openPtyFocus('manual-b'), true);
    state.snapshot.sessions.push(bridge('terminal:late-a', 'create-a'));
    focus.syncPendingPtyFocus();
    assert.deepStrictEqual(opened, ['manual-b'],
      'A create 대기 뒤 B를 직접 열었으면 늦게 나타난 A snapshot이 focus를 빼앗으면 안 됩니다.');
    assert.equal(state.ptyFocusSessionId, 'manual-b');

    const navState = { snapshot: { sessions: [] } };
    const navOpened = [];
    const navFocus = sandbox.window.WhiteboxAppFactories.createPtyFocusMode({
      state: navState,
      $: () => null,
      __openSpy: id => navOpened.push(id),
    });
    navFocus.bindPtyFocusEvents();
    assert.equal(navFocus.openPtyFocusForTerminal('terminal:nav-a', { creationId: 'create-nav-a' }), false);
    sandbox.window.dispatchEvent(new sandbox.CustomEvent('whitebox:terminal-manual-selection'));
    navState.snapshot.sessions.push(bridge('terminal:nav-a', 'create-nav-a'));
    navFocus.syncPendingPtyFocus();
    assert.deepStrictEqual(navOpened, [],
      'pending direct projection 뒤 사용자가 화면을 이동하면 늦게 도착한 projection이 PTY focus를 열면 안 됩니다.');
  });

  test('PTY 집중 모드의 도움 AI와 실행 항목은 오른쪽 상세 패널로 연다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-pty-focus.js'), 'utf8');
    const element = (extra = {}) => ({
      className: '',
      dataset: {},
      innerHTML: '',
      textContent: '',
      classList: { contains: () => false, toggle: () => false },
      setAttribute() {},
      hasChildNodes() { return false; },
      querySelector: () => null,
      ...extra,
    });
    const statusLabel = element();
    const statusTime = element();
    const elements = new Map([
      ['ptyFocusSurface', element()],
      ['ptyFocusProviderMark', element()],
      ['ptyFocusTerminalMark', element()],
      ['ptyFocusEyebrow', element()],
      ['ptyFocusTitle', element()],
      ['ptyFocusSummary', element()],
      ['ptyFocusTerminalTitle', element()],
      ['ptyFocusTerminalHelp', element()],
      ['ptyFocusRootStatus', element({ querySelector: selector => selector === 'b' ? statusLabel : statusTime })],
      ['ptyFocusTerminalShell', element()],
      ['ptyFocusTerminalViewport', element()],
      ['ptyFocusTranscriptContent', element()],
      ['ptyFocusFlow', element()],
    ]);
    const rootSession = {
      id: 'root', provider: 'codex', title: '담당 작업', status: 'running', statusDetail: '진행 중',
      updatedAt: '2026-09-02T00:00:00.000Z', childIds: ['child'], controlCapabilities: { pty: true },
      executions: [{ id: 'exec', kind: 'shell', command: 'npm test', status: 'running' }],
    };
    const childSession = {
      id: 'child', parentId: 'root', provider: 'codex', title: '도움 작업', status: 'running',
      statusDetail: '확인 중', updatedAt: '2026-09-02T00:01:00.000Z', childIds: [], executions: [],
    };
    const sandbox = {
      document: { querySelector: () => null },
      window: {
        WhiteboxAppFactories: {},
        WhiteboxI18n: { t: key => key },
        WhiteboxRendererUtils: { isWritableDirectSession: () => true },
      },
    };
    vm.runInNewContext(source, sandbox, { filename: 'app-pty-focus.js' });
    const focus = sandbox.window.WhiteboxAppFactories.createPtyFocusMode({
      state: { ptyFocusSessionId: 'root', snapshot: { sessions: [rootSession, childSession] } },
      $: selector => elements.get(String(selector).replace(/^#/, '')) || null,
      esc: value => String(value),
      providerInfo: () => ({ mark: 'C' }),
      providerStyle: () => '',
      connectedGraphSessions: sessions => ({ byId: new Map(sessions.map(session => [session.id, session])) }),
      controlRoomAgentGoal: session => ({ text: session.title, full: session.title }),
      controlRoomSummary: value => ({ text: String(value), full: String(value) }),
      latestWorkCopy: session => session.statusDetail || '',
      subagentWorkLabel: session => session.status,
      inferredExecutionSummary: activity => ({ text: activity.command, full: activity.command }),
      executionActivityStatus: activity => activity.status,
      controlRoomStatus: session => session.status,
      sessionStatusLabel: session => session.status,
      timeAgo: () => '방금',
    });
    focus.renderPtyFocus();
    const flowHtml = elements.get('ptyFocusFlow').innerHTML;
    assert.equal((flowHtml.match(/class="pty-focus-flow-lane"/gu) || []).length, 3,
      'PTY focus의 담당·진행·완료 상태 레인이 모두 렌더링되어야 합니다.');
    assert.match(flowHtml, /도움 작업[\s\S]*npm test/u,
      '도움 AI와 실행 작업 상태가 PTY focus DOM에 렌더링되어야 합니다.');
    assert.match(flowHtml, /<button[^>]*data-pty-focus-child="child"[^>]*aria-haspopup="dialog"[^>]*aria-controls="detailDrawer"/u,
      '도움 AI 행은 공용 오른쪽 상세 패널을 여는 버튼이어야 합니다.');
    assert.match(flowHtml, /<button[^>]*data-pty-focus-execution-owner="root"[^>]*data-pty-focus-execution="exec"[^>]*aria-haspopup="dialog"[^>]*aria-controls="detailDrawer"/u,
      '실행 항목 행은 공용 오른쪽 상세 패널을 여는 버튼이어야 합니다.');
    assert.match(source, /const child = event\.target\.closest\("\[data-pty-focus-child\]"\)[\s\S]*context\.openSubagentConversation\?\.\(child\.dataset\.ptyFocusChild/u,
      '도움 AI 버튼이 상세 패널 진입점에 연결되지 않았습니다.');
    assert.match(source, /const execution = event\.target\.closest\("\[data-pty-focus-execution\]"\)[\s\S]*context\.openExecutionActivity\?\.\(/u,
      '실행 항목 버튼이 상세 패널 진입점에 연결되지 않았습니다.');
    assert.doesNotMatch(source, /ptyFocusChildModal|subagentConversationHtml/u,
      '별도 PTY 하위 팝업을 복제하지 말고 공용 drawer 진입점을 사용해야 합니다.');
  });

  test('같은 세션의 최신 스냅샷에서 확인된 대화는 상세 캐시가 갱신될 때까지 보존한다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
    const sandbox = {
      localStorage: { getItem: () => null, setItem: () => {} },
      document: { documentElement: { dataset: {} } },
      console: { info: () => {} },
      window: {
        WhiteboxAppFactories: {},
        WhiteboxRendererUtils: {
          $: () => null, $$: () => [], esc: value => String(value), uiLocale: () => 'ko',
          providerLabel: value => value, reportRecoverableError: () => {},
        },
        matchMedia: () => ({ matches: false, addEventListener: () => {} }),
        WhiteboxI18n: { t: key => key, observedText: value => value },
        WhiteboxConversationDelivery: {
          messageKey: message => `id:${message.id}`,
        },
      },
    };
    vm.runInNewContext(source, sandbox, { filename: 'app.js' });
    const core = sandbox.window.WhiteboxAppFactories.createCore({});
    const staleDetail = {
      id: 'same-session',
      messages: [{ id: 'old-answer', role: 'assistant', text: '이전 답변' }],
    };
    const deliveredUser = {
      id: 'new-user', role: 'user', text: '화면에서 사라지면 안 되는 질문', timestamp: '2026-08-04T01:00:00.000Z',
    };
    const deliveredAssistant = {
      id: 'new-answer', role: 'assistant', text: '새 답변', timestamp: '2026-08-04T01:00:01.000Z',
    };

    core.observeConversationDelivery(staleDetail, {}, {
      phase: 'responded',
      observationSessionId: staleDetail.id,
      userMessage: deliveredUser,
      assistantMessage: deliveredAssistant,
    });

    assert.deepStrictEqual(
      Array.from(core.state.resolvedConversationMessages.get(staleDetail.id) || [], message => message.id),
      ['new-user', 'new-answer'],
    );
  });

  test('포커스 작업 흐름 연결선 모션은 주기적 상태 새로고침 뒤에도 유지한다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-graph-view.js'), 'utf8');
    const focusedStart = source.indexOf('function focusedGraph(');
    const focusedEnd = source.indexOf('\n  return {', focusedStart);
    const focusedSource = source.slice(focusedStart, focusedEnd);
    assert.ok(focusedStart >= 0 && focusedEnd > focusedStart, '포커스 작업 흐름 렌더러를 찾을 수 없습니다.');
    assert.ok(focusedSource.includes('const connectMotion = "motion-connect";'));
    assert.equal(focusedSource.includes('["focus", "focus-back", "view"].includes(motionKind)'), false);
    assert.ok(focusedSource.includes('workflowProgressPanel(focus, children)'), '작업 흐름에 읽기 전용 진행 현황이 없습니다.');
    assert.ok(focusedSource.includes('const chatTitle = parent ? null : workflowChatTitle(focus, 48);')
      && focusedSource.includes('data-workflow-chat-title="${esc(focus.id)}"')
      && focusedSource.includes('${esc(chatTitle.text)}'),
    '작업 진행 화면의 왼쪽 시작점에 저장된 Claude/GPT 채팅 제목을 표시해야 합니다.');
    assert.equal(focusedSource.includes('context.agentCommandComposer(focus)'), false, '별도 대화창이 있는데 작업 진행 화면에 지시 입력창이 다시 노출되었습니다.');
    assert.ok(source.includes('data-workflow-progress='), '현재 단계와 최근 활동을 식별할 진행 패널 계약이 없습니다.');
    assert.ok(source.includes('graph.progress_basis_note'), '기록된 단계 비율을 전체 계획 진척률로 오해하지 않도록 근거 안내가 필요합니다.');
  });

  test('루트 작업은 PTY로, 하위·실행 상세는 오른쪽 패널로 라우팅한다', () => {
    const graph = fs.readFileSync(path.join(root, 'renderer', 'app-graph-view.js'), 'utf8');
    const events = fs.readFileSync(path.join(root, 'renderer', 'app-events-sessions.js'), 'utf8');
    const dashboard = fs.readFileSync(path.join(root, 'renderer', 'app-dashboard.js'), 'utf8');
    const navigationEvents = fs.readFileSync(path.join(root, 'renderer', 'app-events-navigation.js'), 'utf8');
    const filterEvents = fs.readFileSync(path.join(root, 'renderer', 'app-events-filters.js'), 'utf8');
    const sessionRenderer = fs.readFileSync(path.join(root, 'renderer', 'app-session-render.js'), 'utf8');
    const drawerSource = fs.readFileSync(path.join(root, 'renderer', 'app-drawer.js'), 'utf8');
    const agentActions = fs.readFileSync(path.join(root, 'renderer', 'app-agent-actions.js'), 'utf8');
    const quality = fs.readFileSync(path.join(root, 'renderer', 'app-quality.js'), 'utf8');
    const runModal = fs.readFileSync(path.join(root, 'renderer', 'app-run-modal.js'), 'utf8');
    const bootstrap = fs.readFileSync(path.join(root, 'renderer', 'app-bootstrap.js'), 'utf8');
    const orchestration = fs.readFileSync(path.join(root, 'renderer', 'app-graph-orchestration.js'), 'utf8');
    const inlineTerminal = fs.readFileSync(path.join(root, 'renderer', 'inline-agent-terminal.js'), 'utf8');
    const ptyFocus = fs.readFileSync(path.join(root, 'renderer', 'app-pty-focus.js'), 'utf8');
    const core = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
    const workbench = fs.readFileSync(path.join(root, 'renderer', 'terminal-workbench.js'), 'utf8');
    const terminalAgent = fs.readFileSync(path.join(root, 'renderer', 'terminal-agent.js'), 'utf8');
    const sharedSource = fs.readFileSync(path.join(root, 'renderer', 'shared.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'renderer', 'styles-workflow-map.css'), 'utf8');
    const controlRoomStyles = fs.readFileSync(path.join(root, 'renderer', 'styles-control-room.css'), 'utf8');
    const ptyFocusStyles = fs.readFileSync(path.join(root, 'renderer', 'styles-pty-focus.css'), 'utf8');

    const graphNodeSource = graph.slice(graph.indexOf('function graphNode('), graph.indexOf('function compactGraphNode('));
    const compactGraphSource = graph.slice(graph.indexOf('function compactGraphNode('), graph.indexOf('function providerFlowLane('));
    const helperNodeSource = graph.slice(graph.indexOf('function controlRoomChildNode('), graph.indexOf('function controlRoomExecutionNode('));
    const executionNodeSource = graph.slice(graph.indexOf('function controlRoomExecutionNode('), graph.indexOf('function controlRoomRetainedDecision('));
    const controlRoomSource = graph.slice(graph.indexOf('function controlRoomSession('), graph.indexOf('function runtimeSeparatedOverview('));
    const historySource = dashboard.slice(dashboard.indexOf('if (historyList) {'), dashboard.indexOf('const projectSelect ='));
    const graphFilterSource = dashboard.slice(dashboard.indexOf('function graphFilteredSessions()'), dashboard.indexOf('function renderProviderVisibilitySettings()'));
    const historyEvents = filterEvents.slice(filterEvents.indexOf('$("#projectHistoryRail")'), filterEvents.indexOf('const controlProjectSelect'));

    assert.match(graphNodeSource, /const writablePtySurface = !session\.parentId[\s\S]*const responsibleFocus = canOpenResponsibleFocus\(session\)[\s\S]*data-pty-focus-trigger=[\s\S]*data-focus-surface=/u,
      '선택한 작업 흐름의 담당 root가 PTY 또는 읽기 전용 집중 모드로 연결되지 않습니다.');
    assert.doesNotMatch(graphNodeSource, /data-inline-pty-trigger=/u,
      '루트 작업 노드가 과거 인라인 PTY 경로를 다시 노출하고 있습니다.');
    assert.match(controlRoomSource, /const responsibleFocus = canOpenResponsibleFocus\(root\)[\s\S]*data-pty-focus-trigger=[\s\S]*data-focus-surface=/u,
      '작업 현황의 담당 root 노드가 PTY 또는 읽기 전용 집중 모드로 연결되지 않습니다.');
    assert.match(sharedSource, /function canOpenResponsibleFocus\(session\)[\s\S]*session\.parentId[\s\S]*session\.clientKind[\s\S]*session\.controlAuthority[\s\S]*session\.importMode/u,
      '담당 집중 모드는 하위·플러그인·외부 제어 projection과 native root를 구분해야 합니다.');
    assert.match(events, /const ptyFocus = event\.target\.closest\("\[data-pty-focus-trigger\]"\)[\s\S]*const requestedId = ptyFocus\.dataset\.ptyFocusTrigger[\s\S]*const root = ownerRootSession\(requestedId\)[\s\S]*const focusId = String\(root\?\.id \|\| requestedId \|\| ""\)[\s\S]*if \(canOpenPtyFocus\(root\)\)[\s\S]*await openDrawer\(focusId,[\s\S]*else if \(canOpenResponsibleFocus\(root\)\)[\s\S]*await openResponsibleFocus\(focusId,[\s\S]*await openDrawer\(requestedId,/u,
      '담당 노드 클릭은 클릭 시점의 PTY 상태를 다시 확인해 exact PTY 또는 읽기 전용 집중 모드로 분기되어야 합니다.');
    assert.match(drawerSource, /function ownerRoot\(value\)[\s\S]*while \(session\?\.parentId[\s\S]*context\.openPtyFocusVerified\?\.\(root\.id,/u,
      '루트 PTY 진입은 담당 root의 exact terminal을 검증해야 합니다.');
    assert.match(helperNodeSource, /data-open-subagent-chat=/u,
      '하위 AI 노드가 복원된 오른쪽 상세 패널 진입점을 제공해야 합니다.');
    assert.match(executionNodeSource, /data-open-execution-owner=[\s\S]*data-open-execution-id=/u,
      '실행 항목이 복원된 오른쪽 상세 패널 진입점을 제공해야 합니다.');
    assert.match(events, /const subagentChat = event\.target\.closest\("\[data-open-subagent-chat\]"\)[\s\S]*openSubagentConversation\(subagentChat\.dataset\.openSubagentChat/u,
      '하위 AI 노드 클릭이 오른쪽 상세 패널에 연결되지 않았습니다.');
    assert.match(events, /const execution = event\.target\.closest\("\[data-open-execution-id\]"\)[\s\S]*openExecutionActivity\(execution\.dataset\.openExecutionOwner, execution\.dataset\.openExecutionId\)/u,
      '실행 항목 클릭이 오른쪽 상세 패널에 연결되지 않았습니다.');
    const ownerPtyRoute = drawerSource.slice(
      drawerSource.indexOf('async function openOwnerPty('),
      drawerSource.indexOf('function openDrawer('),
    );
    const verifiedOpenIndex = ownerPtyRoute.indexOf('await context.openPtyFocusVerified?.(root.id,');
    const acknowledgeIndex = ownerPtyRoute.indexOf('acknowledgeSessionNotices(selected || id)');
    assert.ok(verifiedOpenIndex >= 0 && acknowledgeIndex > verifiedOpenIndex,
      '작업 알림은 담당 PTY의 verified mount가 성공하기 전에 사라지면 안 됩니다.');
    assert.match(ownerPtyRoute, /if \(outcome\?\.opened === true\) \{[\s\S]*acknowledgeSessionNotices\(selected \|\| id\)/u,
      '작업 알림 확인은 verified PTY 성공 분기 안에서만 실행되어야 합니다.');
    const commonReviewHandler = events.slice(
      events.indexOf('const completeResultReview = async'),
      events.indexOf('$("#operationsOverview").addEventListener("click"'),
    );
    const receiptIndex = commonReviewHandler.indexOf('const expectedTargets = resultReviewTargets(sessionId, { allowPtyCreation: true }).map');
    const openReviewPtyIndex = commonReviewHandler.indexOf('await openPtyFocusVerified(sessionId, {');
    const markReviewIndex = commonReviewHandler.indexOf('markResultReviewComplete(sessionId, { expectedTargets })');
    assert.ok(receiptIndex >= 0 && receiptIndex < openReviewPtyIndex,
      '확인 완료 클릭 시 PTY를 열기 전에 대상 id/stamp receipt를 캡처해야 합니다.');
    assert.match(commonReviewHandler, /const ptyTarget = resultReviewPtyTarget\(sessionId\)[\s\S]*const terminalId =[\s\S]*await openPtyFocusVerified\(sessionId, \{[\s\S]*focus: true,[\s\S]*targetId: terminalId,[\s\S]*terminalId,/u,
      '확인 완료 버튼은 decoy가 아닌 담당 root의 exact PTY identity를 verifier에 전달해야 합니다.');
    assert.match(commonReviewHandler, /else \{[\s\S]*await openDrawer\(sessionId, \{[\s\S]*focus: true,[\s\S]*acknowledge: false,[\s\S]*\}\) === true/u,
      'live PTY가 없는 safe Codex Desktop 결과는 일반 카드와 같은 exact fork router로 열어야 합니다.');
    assert.ok(openReviewPtyIndex >= 0 && markReviewIndex > openReviewPtyIndex
      && commonReviewHandler.indexOf('if (opened)') < markReviewIndex,
      '확인 완료 상태는 exact PTY mount 성공 뒤에만 처리해야 합니다.');
    assert.match(commonReviewHandler, /const completed = markResultReviewComplete\(sessionId, \{ expectedTargets \}\)[\s\S]*if \(completed > 0\)/u,
      'PTY를 보는 동안 결과 stamp가 바뀌면 확인 성공 toast를 내면 안 됩니다.');
    assert.match(commonReviewHandler, /reviewComplete\.disabled = false;[\s\S]*reviewComplete\.removeAttribute\("aria-busy"\)/u,
      'verified PTY mount 실패 뒤 확인 완료 버튼을 다시 시도할 수 있어야 합니다.');
    const operationsReviewHandler = events.slice(
      events.indexOf('$("#operationsOverview").addEventListener("click"'),
      events.indexOf('$("#operationsOverview").addEventListener("input"'),
    );
    assert.match(operationsReviewHandler, /event\.target\.closest\("\[data-result-review-complete\]"\)[\s\S]*await completeResultReview\(reviewComplete\)/u,
      '작업 현황의 확인 완료 동작이 공통 verified PTY handler에 연결되지 않았습니다.');
    assert.doesNotMatch(events, /attentionInbox|renderAttentionInbox|selectView\("waiting"\)/u,
      '삭제된 독립 확인 페이지의 상호작용이 남아 있습니다.');
    assert.match(events, /if \(result\?\.requiresText\)[\s\S]*openPtyFocusVerified\(session\.id, \{[\s\S]*targetId: result\.target\.id,[\s\S]*terminalId: result\.target\.terminalId \|\| result\.target\.id/u,
      '화면에서 답한 추가 입력 요청은 응답한 exact PTY로 이동해야 합니다.');
    assert.match(bootstrap, /handleTerminalPromptResolved = async[\s\S]*openPtyFocusVerified\?\.\(session\.id, \{[\s\S]*targetId: resolution\.targetId,[\s\S]*terminalId: resolution\.terminalId/u,
      'IPC로 완료된 추가 입력 요청도 exact PTY로 이동해야 합니다.');
    const openAgentTerminalSource = agentActions.slice(
      agentActions.indexOf('async function openAgentTerminal('),
      agentActions.indexOf('async function copyBridgeCommand('),
    );
    assert.match(openAgentTerminalSource, /openPtyFocusVerified\?\.\(session\.id, \{[\s\S]*targetId: target\.id,[\s\S]*terminalId: target\.terminalId \|\| target\.id/u,
      'PTY 열기 동작은 선택된 exact target을 full focus verifier로 전달해야 합니다.');
    assert.doesNotMatch(openAgentTerminalSource, /selectView\(["']terminal["']\)|selectSession\(/u,
      '일반 terminal 화면이나 전역 PTY 선택으로 우회하면 안 됩니다.');
    assert.ok(html.includes('id="ptyFocusSurface"')
      && html.includes('id="ptyFocusTerminalViewport"')
      && html.includes('id="ptyFocusTranscriptContent"'),
    '담당 노드 집중 surface에는 실제 xterm과 읽기 전용 작업 기록 viewport가 모두 필요합니다.');
    for (const restoredId of ['detailDrawer', 'drawerBackdrop']) {
      assert.equal(html.includes(`id="${restoredId}"`), true, `${restoredId} 오른쪽 상세 패널이 누락됐습니다.`);
    }
    assert.equal(html.includes('id="ptyFocusChildModal"'), false,
      '별도 PTY 하위 팝업 대신 공용 상세 패널을 사용해야 합니다.');
    assert.match(ptyFocus, /data-pty-focus-child=[\s\S]*aria-controls="detailDrawer"[\s\S]*data-pty-focus-execution=/u,
      'PTY 집중 흐름의 하위·실행 행이 공용 상세 패널을 열어야 합니다.');
    assert.doesNotMatch(ptyFocus, /ptyFocusChildModal|subagentConversationHtml/u,
      '별도 PTY 하위 팝업 구현이 다시 추가되면 안 됩니다.');
    assert.match(ptyFocus, /function openResponsibleFocus\(sessionId, options = \{\}\)[\s\S]*activeFocusMode = "transcript"[\s\S]*refreshTranscriptDetail\(root\)/u,
      '독립 PTY가 없는 담당 노드는 full-screen 읽기 전용 작업 기록으로 열려야 합니다.');
    assert.match(ptyFocus, /function mergedTranscriptMessages\(detail, live\)[\s\S]*function refreshTranscriptDetail\(root\)[\s\S]*loadSessionDetail\(id, true, snapshotVersion\)[\s\S]*function syncPendingPtyFocus\(\)[\s\S]*activeFocusMode === "transcript"\) refreshTranscriptDetail\(root\)/u,
      '열린 읽기 전용 집중 화면은 최신 snapshot을 즉시 합치고 버전이 바뀐 전체 기록을 다시 읽어야 합니다.');
    assert.match(ptyFocus, /const previousText = String\(previous\?\.text \|\| ""\)[\s\S]*const liveText = String\(message\?\.text \|\| ""\)[\s\S]*previousText\.length > liveText\.length \? previousText : liveText/u,
      'snapshot 카드의 축약 메시지가 같은 ID의 전체 상세 메시지를 다시 잘라내면 안 됩니다.');
    assert.match(inlineTerminal, /isReadOnlyResponsibleFocus\(instance\)[\s\S]*reason: "read-only-focus"/u,
      '수동 PTY 동기화가 읽기 전용 담당 노드 집중 화면을 닫으면 안 됩니다.');
    assert.match(ptyFocus, /function openPtyFocusForTerminal\(terminalId, options = \{\}\)[\s\S]*pendingFocus = \{[\s\S]*creationId:/u,
      '새 작업은 exact terminalId/creationId를 보존해 같은 PTY를 집중 모드로 열어야 합니다.');
    assert.match(ptyFocus, /function tryPendingPtyFocus\(\)[\s\S]*const request = pendingFocus;[\s\S]*openPtyFocus\(session\.id, \{[\s\S]*targetId: request\.terminalId,[\s\S]*requireTargetId: true,/u,
      '새 작업의 늦은 projection도 생성 요청의 exact terminalId를 필수 target으로 강제해야 합니다.');
    assert.ok(ptyFocus.includes('controller.enterFocus(id, { focus: options.focus !== false })')
      && /controller\.sync\(\{[\s\S]*force: true,[\s\S]*targetId,[\s\S]*requireTargetId:/u.test(ptyFocus)
      && inlineTerminal.includes('terminal.mountForAgent(session'),
    'PTY 집중 모드는 기존 실제 terminal host를 재사용해 mount해야 합니다.');
    assert.match(ptyFocus, /state\.ptyFocusTargetId = String\(options\.targetId \|\| focusIdentity\?\.terminalId \|\| ""\)\.trim\(\)/u,
      'focus lifetime 동안 exact terminal target identity를 고정해야 합니다.');
    assert.match(inlineTerminal, /const focusTargetId = isFocusSurface[\s\S]*state\.ptyFocusTargetId[\s\S]*const requireTargetId = options\.requireTargetId === true \|\| Boolean\(focusTargetId\)/u,
      'passive focus sync도 고정된 targetId를 필수로 검증해야 합니다.');
    assert.match(ptyFocus, /whitebox:terminal-manual-selection/u,
      '직접 PTY 선택은 오래된 attention 이동을 취소하는 신호를 보내야 합니다.');
    assert.match(bootstrap, /whitebox:terminal-manual-selection[\s\S]*attentionActivation\?\.userNavigated\(\)/u,
      '수동 PTY 선택 신호가 attention controller의 stale 이동을 취소해야 합니다.');
    assert.match(core, /function selectViewFromUser\(view, options = \{\}\)[\s\S]*signalManualTerminalSelection\(\)[\s\S]*return selectView\(view, options\)/u,
      '사용자 화면 이동은 pending attention/direct PTY focus를 먼저 취소해야 합니다.');
    assert.match(navigationEvents, /const viewNavigation = \$\("\.view-nav"\);[\s\S]*viewNavigation\?\.addEventListener\("click"[\s\S]*selectViewFromUser\(button\.dataset\.view\)/u,
      '내비게이션 클릭은 수동 선택 신호를 포함한 화면 전환 경로를 사용해야 합니다.');
    assert.match(drawerSource, /async function openOwnerPty\(id, options = \{\}\)[\s\S]*if \(options\.attentionActivation !== true\) signalManualTerminalSelection\(\)/u,
      '다른 작업 노드 클릭은 target 확인 전 즉시 pending PTY 이동을 취소해야 합니다.');
    assert.match(quality, /function openQuickPalette\(\)[\s\S]*signalManualTerminalSelection\(\)/u,
      'Ctrl+K 빠른 이동은 늦은 direct PTY projection을 취소해야 합니다.');
    assert.match(quality, /function openShortcutHelp\(\)[\s\S]*signalManualTerminalSelection\(\)/u,
      '단축키 도움말도 늦은 PTY focus보다 사용자 gesture를 우선해야 합니다.');
    assert.match(runModal, /function openRunModal\(\)[\s\S]*signalManualTerminalSelection\(\)/u,
      '새 작업 modal은 pending PTY focus를 취소한 뒤 열려야 합니다.');
    assert.match(ptyFocus, /addEventListener\("whitebox:terminal-manual-selection"[\s\S]*pendingFocus = null/u,
      '수동 화면 이동 신호가 snapshot 대기 중인 direct PTY projection을 취소해야 합니다.');
    assert.doesNotMatch(terminalAgent, /legacyWorkbench|#terminalSection/u,
      '삭제된 legacy terminal 화면의 hidden 전역 선택 분기가 다시 추가되었습니다.');
    assert.match(sharedSource, /function appOwnedBridgeTerminalIdentity\(session\)[\s\S]*terminalId[\s\S]*creationId/u,
      '새 작업의 provisional bridge를 exact app-owned PTY로 판정하는 계약이 없습니다.');
    assert.match(historySource, /hasWritablePtySurface\(session\)[\s\S]*data-pty-focus-trigger=/u,
      '지난 작업의 writable root도 PTY 집중 모드로 열려야 합니다.');
    assert.match(ptyFocusStyles, /\.pty-focus-surface/u);
    assert.doesNotMatch(ptyFocusStyles, /\.pty-focus-child-modal/u);
  });

  test('인라인 작업 현황의 확인 완료는 verified PTY 성공 뒤에만 처리한다', async () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-events-sessions.js'), 'utf8');
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) {
        const listeners = new Map();
        elements.set(id, {
          listeners,
          addEventListener(type, listener) { listeners.set(type, listener); },
          querySelectorAll() { return []; },
        });
      }
      return elements.get(id);
    };
    const opened = [];
    const drawerOpened = [];
    const completed = [];
    const rendered = [];
    const announcements = [];
    const reportedErrors = [];
    const outcomes = [{ opened: false }, { opened: true }, { opened: true }];
    const drawerOutcomes = [true, false, 'reject'];
    const expectedReviewSessions = [{ id: 'result-child', status: 'completed' }];
    let committedResults = [1, 0, 1];
    let exactPtyTarget = {
      id: 'terminal-bridge-exact', terminalId: 'terminal-bridge-exact', kind: 'terminal',
    };
    const sandbox = {
      window: {
        WhiteboxAppFactories: {},
        WhiteboxI18n: { t: key => key },
        WhiteboxRendererUtils: {
          reportRecoverableError: (scope, error) => reportedErrors.push([scope, error.message]),
        },
        WhiteboxTerminal: {},
      },
      document: {},
      CSS: { escape: value => String(value) },
      requestAnimationFrame: callback => { callback(); return 1; },
    };
    vm.runInNewContext(source, sandbox, { filename: 'app-events-sessions-review-complete.js' });
    const bindings = sandbox.window.WhiteboxAppFactories.createSessionEventBindings({
      $: selector => element(String(selector).replace(/^#/, '')),
      state: {
        snapshot: { sessions: [] },
        agentCommandDrafts: new Map(),
        agentCommandRoutes: new Map(),
        providerVisibility: {},
      },
      openPtyFocusVerified: async (sessionId, options) => {
        opened.push([sessionId, { ...options }]);
        return outcomes.shift();
      },
      openDrawer: async (sessionId, options) => {
        drawerOpened.push([sessionId, { ...options }]);
        const outcome = drawerOutcomes.shift();
        if (outcome === 'reject') throw new Error('fork rejected');
        return outcome;
      },
      resultReviewPtyTarget: () => exactPtyTarget,
      resultReviewTargets: () => expectedReviewSessions,
      resultReviewStamp: session => `stamp:${session.id}`,
      markResultReviewComplete: (sessionId, options) => {
        completed.push([sessionId, options]);
        return committedResults.shift();
      },
      renderSessions: reason => rendered.push(reason),
      announce: message => announcements.push(message),
    });
    bindings.bindSessionAndAgentEvents();

    const reviewButton = sessionId => {
      const attributes = new Set();
      return {
        dataset: { resultReviewComplete: sessionId },
        disabled: false,
        attributes,
        closest(selector) { return selector === '[data-result-review-complete]' ? this : null; },
        setAttribute(name) { attributes.add(name); },
        removeAttribute(name) { attributes.delete(name); },
      };
    };
    const failedButton = reviewButton('review-from-overview-failed');
    await elements.get('operationsOverview').listeners.get('click')({ target: failedButton });
    assert.deepStrictEqual(opened[0], ['review-from-overview-failed', {
      focus: true,
      targetId: 'terminal-bridge-exact',
      terminalId: 'terminal-bridge-exact',
    }]);
    assert.equal(failedButton.disabled, false);
    assert.equal(failedButton.attributes.has('aria-busy'), false);
    assert.deepStrictEqual(completed, [], 'PTY mount 실패를 확인 완료로 저장하면 안 됩니다.');
    assert.equal(announcements.at(-1), 'agent.open_terminal_failed');

    const completedButton = reviewButton('review-from-overview');
    await elements.get('operationsOverview').listeners.get('click')({ target: completedButton });
    assert.deepStrictEqual(opened[1], ['review-from-overview', {
      focus: true,
      targetId: 'terminal-bridge-exact',
      terminalId: 'terminal-bridge-exact',
    }]);
    assert.equal(completedButton.disabled, true);
    assert.equal(completedButton.attributes.has('aria-busy'), true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(completed)), [[
      'review-from-overview',
      { expectedTargets: [{ id: 'result-child', stamp: 'stamp:result-child' }] },
    ]]);
    assert.deepStrictEqual(rendered, ['result-reviewed']);
    assert.equal(announcements.at(-1), 'management.result_review_completed_toast');

    const changedWhileOpening = reviewButton('review-raced-result');
    await elements.get('operationsOverview').listeners.get('click')({ target: changedWhileOpening });
    assert.equal(changedWhileOpening.disabled, false);
    assert.equal(changedWhileOpening.attributes.has('aria-busy'), false);
    assert.equal(rendered.length, 1, 'stamp race에서 결과 확인 완료 렌더를 실행하면 안 됩니다.');
    assert.equal(announcements.at(-1), 'agent.open_terminal_failed',
      'PTY mount 중 결과가 바뀌어 receipt commit이 0이면 성공 toast를 내면 안 됩니다.');

    exactPtyTarget = null;
    const markAttemptsBeforeFork = completed.length;
    const forkedButton = reviewButton('review-safe-fork');
    await elements.get('operationsOverview').listeners.get('click')({ target: forkedButton });
    assert.deepStrictEqual(drawerOpened[0], ['review-safe-fork', { focus: true, acknowledge: false }]);
    assert.equal(forkedButton.disabled, true);
    assert.equal(forkedButton.attributes.has('aria-busy'), true);
    assert.equal(completed.length, markAttemptsBeforeFork + 1,
      'safe fork의 verified PTY가 열린 경우에만 확인 stamp를 저장해야 합니다.');
    assert.equal(rendered.length, 2);
    assert.equal(announcements.at(-1), 'management.result_review_completed_toast');

    const failedForkButton = reviewButton('review-safe-fork-failed');
    await elements.get('operationsOverview').listeners.get('click')({ target: failedForkButton });
    assert.deepStrictEqual(drawerOpened[1], ['review-safe-fork-failed', { focus: true, acknowledge: false }]);
    assert.equal(failedForkButton.disabled, false);
    assert.equal(failedForkButton.attributes.has('aria-busy'), false);
    assert.equal(completed.length, markAttemptsBeforeFork + 1, 'safe fork 실패를 확인 완료로 저장하면 안 됩니다.');
    assert.equal(rendered.length, 2);
    assert.equal(announcements.at(-1), 'agent.open_terminal_failed');

    const rejectedForkButton = reviewButton('review-safe-fork-rejected');
    await elements.get('operationsOverview').listeners.get('click')({ target: rejectedForkButton });
    assert.equal(rejectedForkButton.disabled, false,
      'PTY open Promise가 reject해도 확인 완료 버튼을 다시 사용할 수 있어야 합니다.');
    assert.equal(rejectedForkButton.attributes.has('aria-busy'), false);
    assert.equal(completed.length, markAttemptsBeforeFork + 1, 'reject된 safe fork를 확인 완료로 저장하면 안 됩니다.');
    assert.equal(announcements.at(-1), 'agent.open_terminal_failed');
    assert.deepStrictEqual(reportedErrors, [['result-review-open-pty', 'fork rejected']]);
  });

  test('프로젝트 선택은 화면 렌더를 기다리게 하지 않고 최상위 AI PTY 사전 연결을 시작한다', () => {
    const filters = fs.readFileSync(path.join(root, 'renderer', 'app-events-filters.js'), 'utf8');
    const actions = fs.readFileSync(path.join(root, 'renderer', 'app-agent-actions.js'), 'utf8');
    const terminal = fs.readFileSync(path.join(root, 'renderer', 'terminal.js'), 'utf8');
    const drawer = fs.readFileSync(path.join(root, 'renderer', 'app-drawer.js'), 'utf8');
    const eventHelper = filters.slice(
      filters.indexOf('function preconnectSelectedWorkspace()'),
      filters.indexOf('function bindFilterAndWorkspaceEvents()'),
    );
    const workspaceClick = filters.slice(
      filters.indexOf('const handleWorkspaceClick = async'),
      filters.indexOf('workspaceLists.forEach'),
    );
    const workspaceSelection = workspaceClick.slice(
      workspaceClick.indexOf('const item = event.target.closest("[data-workspace], [data-source-workspace]")'),
      workspaceClick.indexOf('if (activeList.id === "projectSidebarList" && state.workspace !== "all")'),
    );

    assert.ok(actions.includes('function preconnectProjectAgentTerminals(workspace = state.workspace)'),
      '선택 프로젝트의 최상위 AI를 수집하는 사전 연결 orchestration이 없습니다.');
    assert.match(actions, /session\.parentId \|\| session\.sourcePluginId \|\| !isLiveSession\(session\)/,
      '사전 연결 후보가 direct source의 active 최상위 AI로 제한되지 않았습니다.');
    assert.match(actions, /requestedSource\.startsWith\("builtin\."\)/,
      '플러그인 프로젝트 선택은 provider PTY 사전 연결을 시작하면 안 됩니다.');
    assert.match(terminal, /ensureForAgent, preconnectForAgents, bindAgentConnection/,
      '터미널 공개 API가 batch 사전 연결 함수를 전달하지 않습니다.');
    assert.ok(terminal.includes("if (agentSession.parentId) return { ok: false, reason: 'parent-controlled', targets: [] };"),
      '중앙 mount API가 하위 AI의 PTY host 연결을 막지 않습니다.');
    assert.match(drawer, /function openSubagentConversation\(id, options = \{\}\) \{[\s\S]*state\.selectedId = id;[\s\S]*openDrawerSurface\("modal"\);[\s\S]*renderDrawer\(\);/u,
      '일반 진입점을 거친 하위 AI가 오른쪽 상세 패널에서 열리지 않습니다.');
    assert.match(eventHelper, /void Promise\.resolve\(preconnectProjectAgentTerminals\(state\.workspace\)\)\.catch/,
      '프로젝트 PTY 사전 연결이 fire-and-forget으로 시작되지 않습니다.');
    assert.doesNotMatch(eventHelper, /await\s+(?:Promise\.resolve\()?preconnectProjectAgentTerminals/,
      '프로젝트 선택 이벤트가 느린 PTY 준비 완료를 기다리고 있습니다.');
    assert.match(
      workspaceSelection,
      /if \(activeList\.id === "projectSidebarList" && state\.view !== "all"\) selectView[\s\S]*else renderSessions\("filter"\);\s*preconnectSelectedWorkspace\(\);/,
      '프로젝트 결과 화면을 먼저 렌더한 뒤 PTY 사전 연결을 백그라운드로 시작해야 합니다.',
    );
  });

  test('터미널은 한글 글리프를 압축하지 않고 휠 이동을 짧게 보간한다', () => {
    const terminal = fs.readFileSync(path.join(root, 'renderer', 'terminal.js'), 'utf8');
    const optionsSource = terminal.slice(
      terminal.indexOf('function xtermOptions('),
      terminal.indexOf('function syncXtermTheme()'),
    );

    assert.match(optionsSource, /letterSpacing:\s*0,/, '음수 자간이 한글 대체 글꼴을 겹쳐 보이게 하면 안 됩니다.');
    assert.doesNotMatch(optionsSource, /letterSpacing:\s*-\d/, '터미널 글리프 셀 간격을 강제로 압축하면 안 됩니다.');
    assert.match(
      optionsSource,
      /smoothScrollDuration:\s*reduceMotion\s*\?\s*0\s*:\s*TERMINAL_SMOOTH_SCROLL_MS/,
      '휠 스크롤은 동작 줄이기 설정을 존중하면서 짧게 보간해야 합니다.',
    );
    assert.match(terminal, /const TERMINAL_SMOOTH_SCROLL_MS\s*=\s*100;/,
      '휠 스크롤 보간은 입력이 밀리지 않는 짧은 시간이어야 합니다.');
  });

  test('프로젝트 사이드바는 드래그와 키보드로 위치를 바꾸고 순서를 저장한다', () => {
    const dashboardSource = fs.readFileSync(path.join(root, 'renderer', 'app-dashboard.js'), 'utf8');
    const filterEvents = fs.readFileSync(path.join(root, 'renderer', 'app-events-filters.js'), 'utf8');
    const drawerSource = fs.readFileSync(path.join(root, 'renderer', 'app-drawer.js'), 'utf8');
    const quality = fs.readFileSync(path.join(root, 'renderer', 'app-quality.js'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'renderer', 'styles-studio-shell.css'), 'utf8');
    const sidebarMarkup = dashboardSource.slice(
      dashboardSource.indexOf('const sidebarPriorityRank'),
      dashboardSource.indexOf('const desktopHtml'),
    );
    const sortableBinding = filterEvents.slice(
      filterEvents.indexOf('const bindSortableSidebarProjects'),
      filterEvents.indexOf('$("#loadMoreBtn")'),
    );
    const treeKeyboardBinding = filterEvents.slice(
      filterEvents.indexOf('workspaceLists.forEach'),
      filterEvents.indexOf('$("#projectHistoryRail")'),
    );

    assert.match(
      sidebarMarkup,
      /const defaultSidebarProjects = \[\.\.\.sidebarProjectNodes\.values\(\)\][\s\S]*?\.filter\(\(item\) => item\.key !== PROJECTLESS_WORKSPACE\)[\s\S]*?const sidebarProjectOrder = ensureProjectOrder\(defaultSidebarProjects\.map\(\(item\) => item\.key\)\);[\s\S]*?const sortedSidebarProjects = defaultSidebarProjects\.sort/,
      '저장된 순서는 source별 목록이 아니라 project-first 최상위 프로젝트에 한 번만 적용해야 합니다.',
    );
    assert.ok(sidebarMarkup.includes('data-project-sortable="${esc(item.key)}"'),
      '프로젝트 경로를 정규화한 정렬 키가 없습니다.');
    assert.ok(sidebarMarkup.includes('draggable="${canReorder ? "true" : "false"}"'),
      '프로젝트가 둘 이상일 때 드래그 가능한 항목을 만들지 않습니다.');
    assertIncludesAll(sidebarMarkup, [
      'data-sidebar-project-key=',
      'data-project-scope=',
      'data-project-source=',
      'project-sidebar-source',
    ]);
    assertIncludesAll(sidebarMarkup, [
      'aria-grabbed="false"',
      'projectKeyboardShortcuts',
      'canReorder ? "Alt+ArrowUp Alt+ArrowDown"',
      'canRemove ? "Delete"',
      'aria-describedby="projectReorderHelp"',
      'project-sidebar-drag-handle',
    ]);
    assertIncludesAll(sortableBinding, [
      'container.addEventListener("dragstart"',
      'container.addEventListener("dragover"',
      'container.addEventListener("drop"',
      'container.addEventListener("dragend"',
      'moveProjectOrder(sourceId, targetId, placeAfter)',
      'saveDashboardPreferences();',
      'renderWorkspaces();',
      'renderSessions("reorder")',
      'event.altKey',
      '"ArrowUp", "ArrowDown"',
    ]);
    assert.ok(filterEvents.includes('bindSortableSidebarProjects($("#projectSidebarList"))'),
      '왼쪽 프로젝트 목록에 정렬 이벤트를 연결하지 않았습니다.');
    assertIncludesAll(treeKeyboardBinding, [
      '["ArrowLeft", "ArrowRight"].includes(event.key)',
      'list.addEventListener("focusin"',
      'setRovingTreeItem(list, treeItem)',
      'treeItem.getAttribute("aria-owns")',
      'candidate.getAttribute("aria-controls") === ownedGroupId',
      'document.getElementById(ownedGroupId)?.querySelector',
      'treeItem.closest(".project-sidebar-source")',
      'treeItem.closest(".project-sidebar-project")',
      `? '[role="treeitem"]'`,
      '{ wrap: !tree, roving: tree }',
      'event.key === "Delete"',
      'querySelector("[data-remove-workspace]")',
      'remove.click()',
    ]);
    assert.match(treeKeyboardBinding, /if \(!treeItem\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/,
      '모든 트리 항목의 Left/Right no-op도 기본 스크롤과 버블링을 막아야 합니다.');
    assert.match(filterEvents, /const next = wrap[\s\S]*Math\.max\(0, Math\.min\(items\.length - 1, requested\)\)/,
      '트리의 Up/Down은 첫 항목과 마지막 항목에서 반대편으로 순환하면 안 됩니다.');
    assert.match(treeKeyboardBinding, /toggle\.click\(\);[\s\S]*focusRememberedTreeItem\(identity\);/,
      '트리 접기/펼치기는 disclosure를 재사용하고 다시 그린 항목으로 포커스를 복원해야 합니다.');
    assert.ok(filterEvents.includes('.project-sidebar-item[role="treeitem"]')
      && filterEvents.includes('.project-sidebar-source-filter[role="treeitem"]'),
    '마우스로 disclosure를 누른 뒤에도 소유 treeitem으로 포커스를 복원해야 합니다.');
    assert.match(filterEvents, /Date\.now\(\) - sidebarProjectDragEndedAt < 250/,
      '드래그 직후 click이 프로젝트 선택으로 실행되는 것을 막아야 합니다.');
    assert.ok(quality.includes('projectOrder: (state.projectOrder || [])'),
      '변경한 프로젝트 순서를 대시보드 환경설정에 저장하지 않습니다.');
    assertIncludesAll(styles, [
      '.project-sidebar-group.project-sort-dragging',
      '.project-sidebar-group[data-project-drop-edge]::after',
      '.project-sidebar-drag-handle',
      'cursor: grab',
      'cursor: grabbing',
    ]);
    assertIncludesAll(dashboardSource, [
      'projectNoticeSignals',
      'acknowledgeProjectNotices',
      'acknowledgeSessionNotices',
      'context.isProjectNoticeSeen?.("result", session)',
      'context.isProjectNoticeSeen?.("attention", session)',
      'context.isProjectNoticeSeen?.("terminal", session, prompt)',
      'priority: attention.length ? "attention" : resultReady.length ? "result-ready"',
    ]);
    assert.match(filterEvents, /acknowledgeProjectNotices\(requestedWorkspace, requestedSource\);[\s\S]*renderWorkspaces\(\);/,
      '프로젝트 선택은 현재 알림을 먼저 확인 처리한 뒤 사이드바를 다시 그려야 합니다.');
    assertIncludesAll(drawerSource, [
      'acknowledgeSessionNotices(selected || id)',
      'context.openPtyFocusVerified?.(root.id,',
      'renderWorkspaces();',
    ]);
    assertIncludesAll(sidebarMarkup, [
      'data-attention-session-count=',
      'data-result-ready-count=',
      'has-result-ready',
    ]);
    assertIncludesAll(styles, ['.project-sidebar-group.has-result-ready']);

    const sidebar = { dataset: {}, innerHTML: '' };
    const sandbox = {
      window: {
        WhiteboxAppFactories: {},
        WhiteboxRendererUtils: {
          canForkCodexDesktopSession: () => false,
          isWritableDirectSession: session => Boolean(session && !session.parentId && !session.sourcePluginId),
        },
        WhiteboxI18n: { t: (key, params = {}) => `${key}:${params.count ?? ''}` },
      },
      document: { body: { dataset: {} } },
      Intl,
    };
    vm.runInNewContext(dashboardSource, sandbox, { filename: 'app-dashboard.js' });
    const state = { projectOrder: [] };
    const dashboard = sandbox.window.WhiteboxAppFactories.createDashboard({ state, visibleSessions: () => [] });
    dashboard.ensureProjectOrder(['project:a', 'project:b', 'project:c']);
    assert.equal(dashboard.moveProjectOrder('project:c', 'project:a', false), true);
    assert.deepStrictEqual(Array.from(state.projectOrder), ['project:c', 'project:a', 'project:b']);
    assert.equal(dashboard.moveProjectOrder('project:c', 'project:b', true), true);
    assert.deepStrictEqual(Array.from(state.projectOrder), ['project:a', 'project:b', 'project:c']);

    const completed = {
      id: 'completed-root', provider: 'codex', status: 'completed', completionObserved: true,
      cwd: 'D:\\repo\\nested\\worktree', originCwd: 'D:\\repo\\nested\\worktree', childIds: [],
      updatedAt: '2026-08-12T01:00:00.000Z', messages: [],
    };
    const premature = {
      ...completed, id: 'premature-root', cwd: 'D:\\repo\\nested', originCwd: 'D:\\repo\\nested',
      childIds: ['running-child'], updatedAt: '2026-08-12T01:01:00.000Z',
    };
    const runningChild = {
      ...completed, id: 'running-child', parentId: premature.id, status: 'running', completionObserved: false,
      childIds: [], updatedAt: '2026-08-12T01:02:00.000Z',
    };
    const resultSessions = [completed, premature, runningChild];
    const resultState = {
      snapshot: { sessions: resultSessions, tmux: { distros: [] } },
      workspaces: [
        { name: '상위', path: 'D:\\repo' },
        { name: '하위', path: 'D:\\repo\\nested' },
      ],
      workspace: 'all', projectOrder: [], dismissedProjects: new Set(), providerMap: new Map(),
      providers: [], availability: {}, sessionOrder: [], view: 'all', search: '', sort: 'recent',
      providerFilters: new Set(),
    };
    let resultReviewed = false;
    const seenNotices = new Set();
    const resultDashboard = sandbox.window.WhiteboxAppFactories.createDashboard({
      $: selector => selector === '#projectSidebarList' ? sidebar : null,
      esc: value => String(value),
      uiLocale: () => 'ko-KR',
      state: resultState,
      visibleSessions: () => resultSessions,
      isProviderVisible: () => true,
      isControlRoomSession: session => session.status === 'running',
      controlRoomStatus: session => session.id === premature.id ? 'running' : session.status,
      resultReviewTargets: session => !resultReviewed && [completed.id, premature.id].includes(session.id) ? [session] : [],
      isProjectNoticeSeen: (kind, session) => seenNotices.has(`${kind}:${session.id}`),
      markProjectNoticesSeen: entries => {
        let changed = 0;
        entries.forEach(entry => {
          const key = `${entry.kind}:${entry.session.id}`;
          if (!seenNotices.has(key)) { seenNotices.add(key); changed += 1; }
        });
        return changed;
      },
    });
    resultDashboard.renderWorkspaces();
    const projectMarkup = key => {
      const marker = `data-project-sortable="${key}"`;
      const start = sidebar.innerHTML.indexOf(marker);
      const next = sidebar.innerHTML.indexOf('data-project-sortable="', start + marker.length);
      return start < 0 ? '' : sidebar.innerHTML.slice(start, next < 0 ? sidebar.innerHTML.length : next);
    };
    const parentProjectMarkup = projectMarkup('d:/repo');
    const nestedProjectMarkup = projectMarkup('d:/repo/nested');
    assert.match(parentProjectMarkup, /data-result-ready-count="0"/,
      '중첩 프로젝트의 완료 결과가 상위 프로젝트에도 중복 집계되면 안 됩니다.');
    assert.match(nestedProjectMarkup, /data-result-ready-count="1"/,
      '실제로 끝난 메인 세션만 소유 프로젝트의 완료 결과로 집계해야 합니다.');
    assert.match(nestedProjectMarkup, /has-result-ready/);
    assert.equal((nestedProjectMarkup.match(/has-result-ready/g) || []).length, 1,
      '하위 작업이 실행 중인 메인 세션을 완료 결과로 먼저 세면 안 됩니다.');

    assert.equal(resultDashboard.acknowledgeProjectNotices('D:\\repo\\nested'), 1);
    resultDashboard.renderWorkspaces();
    assert.equal(sidebar.innerHTML.includes('has-result-ready'), false,
      '프로젝트를 확인한 뒤 완료 결과 강조가 남아 있으면 안 됩니다.');
    completed.updatedAt = '2026-08-12T02:00:00.000Z';
    seenNotices.clear();
    resultDashboard.renderWorkspaces();
    assert.match(projectMarkup('d:/repo/nested'), /data-result-ready-count="1"/,
      '새 완료 결과 신호가 생기면 프로젝트 배지가 다시 표시되어야 합니다.');

    resultReviewed = true;
    resultDashboard.renderWorkspaces();
    assert.equal(sidebar.innerHTML.includes('has-result-ready'), false,
      '결과 확인을 마친 뒤 프로젝트 완료 결과 강조가 남아 있으면 안 됩니다.');
    assert.doesNotMatch(sidebar.innerHTML, /data-result-ready-count="[1-9]\d*"/);
  });

  test('프로젝트 아래 프로그램과 root 작업을 계층화하고 두 disclosure·source 필터·프로젝트 없음을 격리한다', () => {
    const dashboardSource = fs.readFileSync(path.join(root, 'renderer', 'app-dashboard.js'), 'utf8');
    const eventSource = fs.readFileSync(path.join(root, 'renderer', 'app-events-filters.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
    const interactionSource = fs.readFileSync(path.join(root, 'scripts', 'interaction-check.js'), 'utf8');
    const qualitySource = fs.readFileSync(path.join(root, 'renderer', 'app-quality.js'), 'utf8');
    const messagesSource = fs.readFileSync(path.join(root, 'renderer', 'i18n-messages.js'), 'utf8');
    const sidebarStyles = fs.readFileSync(path.join(root, 'renderer', 'styles-studio-shell.css'), 'utf8');
    const sidebar = { dataset: {}, innerHTML: '' };
    const sandbox = {
      window: {
        WhiteboxAppFactories: {},
        WhiteboxRendererUtils: {
          canForkCodexDesktopSession: () => false,
          isWritableDirectSession: session => Boolean(session && !session.parentId && !session.sourcePluginId),
        },
        WhiteboxI18n: {
          t(key, params = {}) {
            if (key === 'settings.plugins.group_direct') return 'Whitebox 프로젝트';
            if (key === 'settings.plugins.group_label') return `${params.plugin} 프로젝트`;
            if (key === 'settings.plugins.project_count') return `${params.count}개`;
            if (key === 'studio.sidebar.more_source_sessions') return `+ ${params.count}개 작업 더 있음`;
            return `${key}:${params.count ?? ''}`;
          },
        },
      },
      document: { body: { dataset: {} } },
      Intl,
    };
    vm.runInNewContext(dashboardSource, sandbox, { filename: 'app-dashboard.js' });
    const cwd = 'D:\\shared\\project';
    const sessions = [
      { id: 'direct-root', provider: 'codex', status: 'idle', cwd, originCwd: cwd, childIds: [], updatedAt: '2026-08-24T05:00:00.000Z' },
      { id: 'direct-root-2', provider: 'codex', status: 'idle', cwd, originCwd: cwd, childIds: [], updatedAt: '2026-08-24T04:00:00.000Z' },
      { id: 'direct-root-3', provider: 'codex', status: 'idle', cwd, originCwd: cwd, childIds: [], updatedAt: '2026-08-24T03:00:00.000Z' },
      { id: 'direct-root-4', provider: 'codex', status: 'idle', cwd, originCwd: cwd, childIds: [], updatedAt: '2026-08-24T02:00:00.000Z' },
      { id: 'direct-root-5', provider: 'codex', status: 'idle', cwd, originCwd: cwd, childIds: [], updatedAt: '2026-08-24T01:00:00.000Z' },
      { id: 'direct-projectless', provider: 'codex', status: 'idle', cwd: '', originCwd: '', projectless: true, childIds: [] },
      { id: 'builtin.opencode:open-root', externalId: 'open-root', sourcePluginId: 'builtin.opencode', provider: 'codex', status: 'idle', cwd, originCwd: cwd, childIds: ['builtin.opencode:open-child'] },
      { id: 'builtin.opencode:open-child', externalId: 'open-child', sourcePluginId: 'builtin.opencode', provider: 'codex', parentId: 'builtin.opencode:open-root', status: 'idle', cwd, originCwd: cwd, childIds: [] },
      { id: 'builtin.opencode:open-projectless', externalId: 'open-projectless', sourcePluginId: 'builtin.opencode', provider: 'codex', status: 'idle', cwd: '', originCwd: '', projectless: true, childIds: [] },
      { id: 'builtin.aside:aside-root', externalId: 'aside-root', sourcePluginId: 'builtin.aside', provider: 'codex', status: 'idle', cwd, originCwd: cwd, childIds: [] },
      { id: 'builtin.aside:aside-projectless', externalId: 'aside-projectless', sourcePluginId: 'builtin.aside', provider: 'codex', status: 'idle', cwd: '', originCwd: '', projectless: true, childIds: [] },
    ];
    sessions.filter(session => !session.sourcePluginId).forEach(session => {
      session.controlCapabilities = { pty: true };
    });
    const state = {
      snapshot: { sessions, tmux: { distros: [] } },
      workspaces: [], workspace: 'all', workspaceSource: 'all', projectOrder: [], dismissedProjects: new Set(),
      sidebarCollapsedProjects: new Set(), sidebarCollapsedSources: new Set(),
      providerMap: new Map(), providers: [], availability: {}, sessionOrder: [], view: 'all', search: '', sort: 'recent',
      providerFilters: new Set(),
      sourcePluginSettings: { version: 2, enabledPluginIds: ['builtin.opencode', 'builtin.aside'], asideHistoryFolders: [] },
      sourcePlugins: [
        { id: 'builtin.opencode', source: { id: 'opencode', label: 'OpenCode' } },
        { id: 'builtin.aside', source: { id: 'aside', label: 'Aside Browser' } },
      ],
    };
    const visibleSessions = () => sessions.filter(session => (
      !session.sourcePluginId || state.sourcePluginSettings.enabledPluginIds.includes(session.sourcePluginId)
    ));
    const dashboard = sandbox.window.WhiteboxAppFactories.createDashboard({
      $: selector => selector === '#projectSidebarList' ? sidebar : null,
      esc: value => String(value),
      uiLocale: () => 'ko-KR',
      PROJECTLESS_WORKSPACE: '__projectless__',
      state,
      visibleSessions,
      isProviderVisible: () => true,
      isControlRoomSession: () => false,
    });

    const tagWith = (markup, marker) => {
      const markerIndex = markup.indexOf(marker);
      assert.ok(markerIndex >= 0, `${marker} 속성이 있는 요소를 찾을 수 없습니다.`);
      const start = markup.lastIndexOf('<', markerIndex);
      const end = markup.indexOf('>', markerIndex);
      return markup.slice(start, end + 1);
    };
    const siblingBlock = (markup, attribute, value) => {
      const marker = `${attribute}="${value}"`;
      const markerIndex = markup.indexOf(marker);
      assert.ok(markerIndex >= 0, `${marker} 계층을 찾을 수 없습니다.`);
      const start = markup.lastIndexOf('<', markerIndex);
      const nextMarker = markup.indexOf(`${attribute}="`, markerIndex + marker.length);
      const end = nextMarker < 0 ? markup.length : markup.lastIndexOf('<', nextMarker);
      return markup.slice(start, end);
    };
    const assertDisclosure = (markup, marker, expanded, controlledClass) => {
      const toggle = tagWith(markup, marker);
      assert.ok(toggle.includes(`aria-expanded="${expanded ? 'true' : 'false'}"`), `${marker} 펼침 상태가 aria-expanded와 다릅니다.`);
      const controls = /aria-controls="([^"]+)"/.exec(toggle)?.[1];
      assert.ok(controls, `${marker}에 aria-controls가 없습니다.`);
      const controlled = tagWith(markup, `id="${controls}"`);
      assert.ok(controlled.includes(controlledClass), `${marker}가 올바른 자식 계층을 제어하지 않습니다.`);
      assert.equal(/(?:^|\s)hidden(?:\s|>)/.test(controlled), !expanded, `${marker}의 controlled children hidden 상태가 반대입니다.`);
      return controls;
    };
    const projectKey = 'd:/shared/project';
    const projectlessKey = '__projectless__';
    const sourceKey = (project, source) => `${project}::${source}`;

    dashboard.renderWorkspaces();
    assert.equal((sidebar.innerHTML.match(/data-sidebar-project-key=/g) || []).length, 2,
      '동일 경로 세 source는 세 프로젝트가 아니라 경로 프로젝트 하나와 프로젝트 없음 하나로 합쳐져야 합니다.');
    assertIncludesAll(sidebar.innerHTML, [
      `data-sidebar-project-key="${projectKey}"`,
      `data-sidebar-project-key="${projectlessKey}"`,
      'Whitebox',
      'OpenCode',
      'Aside Browser',
    ]);
    const sharedProject = siblingBlock(sidebar.innerHTML, 'data-sidebar-project-key', projectKey);
    const projectless = siblingBlock(sidebar.innerHTML, 'data-sidebar-project-key', projectlessKey);
    assert.equal((sharedProject.match(/data-sidebar-source-key=/g) || []).length, 3,
      '한 프로젝트 아래 Whitebox·OpenCode·Aside 프로그램 행이 각각 있어야 합니다.');
    assert.equal((projectless.match(/data-sidebar-source-key=/g) || []).length, 3,
      '프로젝트 없음도 별도 source-first 목록이 아니라 같은 프로젝트→프로그램 계층이어야 합니다.');
    for (const source of ['direct', 'builtin.opencode', 'builtin.aside']) {
      assert.ok(sharedProject.includes(`data-sidebar-source-key="${sourceKey(projectKey, source)}"`));
      assert.ok(projectless.includes(`data-sidebar-source-key="${sourceKey(projectlessKey, source)}"`));
      const expectedKind = source === 'direct' ? 'program' : 'plugin';
      assert.ok(tagWith(
        siblingBlock(sharedProject, 'data-sidebar-source-key', sourceKey(projectKey, source)),
        `data-sidebar-source-key="${sourceKey(projectKey, source)}"`,
      ).includes(`data-source-kind="${expectedKind}"`),
      `${source} 행이 ${expectedKind} 유형임을 마크업에서 구분할 수 없습니다.`);
      assert.ok(sharedProject.includes(`data-source-workspace="${cwd}" data-project-source="${source}"`),
        `${source} 프로그램 필터가 동일 경로의 다른 source와 구분되지 않았습니다.`);
      assert.ok(projectless.includes(`data-source-workspace="${projectlessKey}" data-project-source="${source}"`),
        `${source} 프로젝트 없음 필터가 source 경계를 잃었습니다.`);
    }
    const sharedProjectSelector = tagWith(sharedProject, `data-workspace="${cwd}" data-project-source="all"`);
    const projectlessSelector = tagWith(projectless, `data-workspace="${projectlessKey}" data-project-source="all"`);
    assert.ok(sharedProjectSelector.includes('project-sidebar-item'),
      '프로젝트 이름 버튼이 source=all인 전체 선택 필터여야 합니다.');
    assert.ok(projectlessSelector.includes('project-sidebar-item'),
      '프로젝트 없음 이름 버튼도 source=all인 전체 선택 필터여야 합니다.');
    assert.equal(sidebar.innerHTML.includes('모든 프로그램과 플러그인'), false,
      '프로젝트 아래에 중복 전체 선택 행을 표시하면 안 됩니다.');
    assert.equal(sidebar.innerHTML.includes('studio.sidebar.all_sources'), false,
      '번역 키가 그대로 보이는 경우에도 중복 전체 선택 행으로 간주해야 합니다.');

    const directProgram = siblingBlock(sharedProject, 'data-sidebar-source-key', sourceKey(projectKey, 'direct'));
    const openCodeProgram = siblingBlock(sharedProject, 'data-sidebar-source-key', sourceKey(projectKey, 'builtin.opencode'));
    const asideProgram = siblingBlock(sharedProject, 'data-sidebar-source-key', sourceKey(projectKey, 'builtin.aside'));
    // Direct root tasks open the full PTY focus surface; imported transcript-only
    // records use the shared read-only detail drawer through data-open-session.
    assertIncludesAll(directProgram, [
      'data-pty-focus-trigger="direct-root"',
      'data-pty-focus-trigger="direct-root-2"',
      'data-pty-focus-trigger="direct-root-3"',
      'project-sidebar-session-more',
      '+ 2개 작업 더 있음',
    ]);
    assert.equal((directProgram.match(/data-pty-focus-trigger=/g) || []).length, 3,
      '작업이 많은 프로그램도 최신 root 작업 3개까지만 미리 보여야 합니다.');
    assert.equal(directProgram.includes('data-pty-focus-trigger="direct-root-4"'), false);
    assert.equal(directProgram.includes('data-pty-focus-trigger="direct-root-5"'), false);
    assert.ok(openCodeProgram.includes('data-open-session="builtin.opencode:open-root"'));
    assert.equal(openCodeProgram.includes('data-open-session="builtin.opencode:open-child"'), false,
      '프로그램 아래에는 하위 agent가 아니라 root session 작업 행만 표시해야 합니다.');
    assert.equal(openCodeProgram.includes('project-sidebar-session-more'), false,
      '남은 root 작업이 없는 프로그램에 더 있음 요약을 표시하면 안 됩니다.');
    assert.ok(asideProgram.includes('data-open-session="builtin.aside:aside-root"'));
    assert.ok(siblingBlock(projectless, 'data-sidebar-source-key', sourceKey(projectlessKey, 'direct'))
      .includes('data-pty-focus-trigger="direct-projectless"'));
    assert.ok(siblingBlock(projectless, 'data-sidebar-source-key', sourceKey(projectlessKey, 'builtin.opencode'))
      .includes('data-open-session="builtin.opencode:open-projectless"'));
    assert.ok(siblingBlock(projectless, 'data-sidebar-source-key', sourceKey(projectlessKey, 'builtin.aside'))
      .includes('data-open-session="builtin.aside:aside-projectless"'));

    const projectTreeItem = tagWith(sharedProject, `data-workspace="${cwd}" data-project-source="all"`);
    const sourceTreeItem = tagWith(openCodeProgram, `data-source-workspace="${cwd}" data-project-source="builtin.opencode"`);
    assertIncludesAll(projectTreeItem, ['role="treeitem"', 'aria-level="1"', 'aria-selected="false"', 'aria-expanded="true"', 'aria-owns=', 'tabindex="0"']);
    assertIncludesAll(sourceTreeItem, ['role="treeitem"', 'aria-level="2"', 'aria-selected="false"', 'aria-expanded="true"', 'aria-owns=', 'tabindex="-1"']);
    assert.equal((sidebar.innerHTML.match(/role="treeitem"[^>]*tabindex="0"/g) || []).length, 1,
      '프로젝트 트리는 렌더 시 진입 가능한 treeitem을 하나만 제공해야 합니다.');
    assert.equal((sidebar.innerHTML.match(/data-sidebar-(?:project|source)-toggle=[^>]*tabindex="-1"/g) || []).length, 8,
      '프로젝트와 프로그램 disclosure는 별도 Tab 정지점이 아니어야 합니다.');
    const removeButtons = sidebar.innerHTML.match(/<button[^>]*data-remove-workspace[^>]*>/g) || [];
    assert.match(dashboardSource, /data-remove-workspace[\s\S]{0,500}?tabindex="-1"/,
      '프로젝트 제거 버튼 정의는 composite tree의 별도 Tab 정지점을 만들지 않아야 합니다.');
    assert.ok(removeButtons.every(button => button.includes('tabindex="-1"')),
      '프로젝트 제거 버튼은 composite tree의 별도 Tab 정지점이 아니어야 합니다.');
    const treeButtons = sidebar.innerHTML.match(/<button[^>]*>/g) || [];
    assert.equal(treeButtons.filter(button => !/tabindex="(?:0|-1)"/.test(button)).length, 0,
      '프로젝트 트리 내부에는 로빙 treeitem 외의 암묵적 Tab 정지점이 없어야 합니다.');
    for (const item of [projectTreeItem, sourceTreeItem]) {
      const ownedId = /aria-owns="([^"]+)"/.exec(item)?.[1];
      assert.ok(ownedId && tagWith(sidebar.innerHTML, `id="${ownedId}"`).includes('role="group"'),
        '트리 선택 항목이 펼침 화살표의 자식 그룹을 접근성 트리에 소유해야 합니다.');
    }

    const controls = [...sidebar.innerHTML.matchAll(/aria-controls="([^"]+)"/g)]
      .map(match => match[1])
      .filter(id => id !== 'ptyFocusSurface');
    assert.equal(controls.length, 8, '프로젝트 2개와 프로그램 6개 모두 독립 disclosure여야 합니다.');
    assert.equal(new Set(controls).size, controls.length, '각 disclosure의 aria-controls 대상 ID가 겹치면 안 됩니다.');
    controls.forEach(id => assert.equal((sidebar.innerHTML.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1));
    assertDisclosure(sharedProject, 'data-sidebar-project-toggle', true, 'project-sidebar-source-list');
    assertDisclosure(openCodeProgram, 'data-sidebar-source-toggle', true, 'project-sidebar-sessions');

    state.sidebarCollapsedProjects.add(projectKey);
    dashboard.renderWorkspaces();
    assertDisclosure(siblingBlock(sidebar.innerHTML, 'data-sidebar-project-key', projectKey),
      'data-sidebar-project-toggle', false, 'project-sidebar-source-list');
    assert.equal(state.sidebarCollapsedSources.size, 0, '프로젝트 접기가 프로그램별 접기 상태를 덮어쓰면 안 됩니다.');

    state.sidebarCollapsedProjects.delete(projectKey);
    state.sidebarCollapsedSources.add(sourceKey(projectKey, 'builtin.opencode'));
    state.workspace = cwd;
    state.workspaceSource = 'builtin.aside';
    dashboard.renderWorkspaces();
    const expandedProject = siblingBlock(sidebar.innerHTML, 'data-sidebar-project-key', projectKey);
    assertDisclosure(siblingBlock(expandedProject, 'data-sidebar-source-key', sourceKey(projectKey, 'builtin.opencode')),
      'data-sidebar-source-toggle', false, 'project-sidebar-sessions');
    assertDisclosure(siblingBlock(expandedProject, 'data-sidebar-source-key', sourceKey(projectKey, 'builtin.aside')),
      'data-sidebar-source-toggle', true, 'project-sidebar-sessions');
    assert.equal(state.workspace, cwd);
    assert.equal(state.workspaceSource, 'builtin.aside');
    const selectedSourceTreeItem = tagWith(expandedProject, `data-project-source="builtin.aside"`);
    assert.ok(selectedSourceTreeItem.includes('aria-selected="true"'),
      '다른 프로그램을 접어도 선택한 source 필터가 바뀌면 안 됩니다.');
    assert.ok(selectedSourceTreeItem.includes('tabindex="0"'),
      '선택한 프로그램은 프로젝트 트리의 단일 Tab 진입점이어야 합니다.');
    assert.equal((sidebar.innerHTML.match(/role="treeitem"[^>]*tabindex="0"/g) || []).length, 1);

    state.sidebarCollapsedProjects.add(projectKey);
    dashboard.renderWorkspaces();
    const collapsedSelectedProject = siblingBlock(sidebar.innerHTML, 'data-sidebar-project-key', projectKey);
    assert.ok(tagWith(collapsedSelectedProject, `data-workspace="${cwd}" data-project-source="all"`).includes('tabindex="0"'),
      '선택한 프로그램의 부모 프로젝트가 접히면 보이는 프로젝트 항목이 Tab 진입점이어야 합니다.');
    assert.equal((sidebar.innerHTML.match(/role="treeitem"[^>]*tabindex="0"/g) || []).length, 1);
    state.sidebarCollapsedProjects.delete(projectKey);
    dashboard.renderWorkspaces();

    const workspaceHandler = eventSource.slice(
      eventSource.indexOf('const handleWorkspaceClick = async (event) => {'),
      eventSource.indexOf('workspaceLists.forEach', eventSource.indexOf('const handleWorkspaceClick = async (event) => {')),
    );
    const projectToggleIndex = workspaceHandler.indexOf('[data-sidebar-project-toggle]');
    const sourceToggleIndex = workspaceHandler.indexOf('[data-sidebar-source-toggle]');
    const filterIndex = workspaceHandler.indexOf('[data-workspace], [data-source-workspace]');
    assert.ok(projectToggleIndex >= 0 && sourceToggleIndex >= 0 && filterIndex > projectToggleIndex && filterIndex > sourceToggleIndex,
      '프로젝트·프로그램 disclosure 화살표는 이름 필터 선택과 분리해 먼저 처리해야 합니다.');
    assert.ok(appSource.includes('"data-source-workspace"'),
      '프로그램 이름 버튼은 렌더 후에도 포커스를 복원할 수 있는 안정 식별자여야 합니다.');
    assert.ok(eventSource.includes(`? '[role="treeitem"]'`),
      '프로젝트·프로그램·작업 이름이 프로젝트 트리의 방향키 탐색 순서에 포함되어야 합니다.');
    assert.ok(eventSource.includes('const workspaceAttribute = trigger.id === "sidebarNewProjectBtn" ? "data-source-workspace" : "data-workspace";'),
      '새 프로젝트를 추가한 뒤 직접 실행 프로그램 행으로 스크롤해야 합니다.');
    assertIncludesAll(eventSource, [
      'state.sidebarCollapsedProjects.delete(selectedKey);',
      'state.sidebarCollapsedSources.delete(`${selectedKey}::direct`);',
    ]);
    assert.ok(interactionSource.includes("{ selector: '[data-source-workspace]', action: 'workspace:source-select' }"),
      '프로그램 이름 버튼이 상호작용 전수 점검 매니페스트에 없습니다.');
    assert.ok(interactionSource.includes("{ selector: '[data-sidebar-project-toggle]', action: 'workspace:project-toggle' }")
      && interactionSource.includes("{ selector: '[data-sidebar-source-toggle]', action: 'workspace:source-toggle' }"),
    '분리된 프로젝트·프로그램 펼침 화살표가 상호작용 전수 점검 매니페스트에 없습니다.');
    assertIncludesAll(workspaceHandler, ['state.sidebarCollapsedProjects', 'state.sidebarCollapsedSources', 'renderWorkspaces()']);
    const concreteSourceSync = workspaceHandler.slice(
      workspaceHandler.indexOf('if (requestedSource !== "all")'),
      workspaceHandler.indexOf('acknowledgeProjectNotices(requestedWorkspace, requestedSource)'),
    );
    assert.match(concreteSourceSync, /^if \(requestedSource !== "all"\) \{/,
      'parent source=all 선택은 기존 실행 source를 유지해야 합니다.');
    assertIncludesAll(concreteSourceSync, [
      'state.runSource = requestedSource;',
      'syncRunComposer();',
      'saveRunDraft();',
    ]);
    assert.ok(
      /state\.runDraft\.sourcePluginId = requestedSource;/.test(concreteSourceSync)
        || /state\.runDraft = \{[\s\S]*?sourcePluginId: requestedSource[\s\S]*?\};/.test(concreteSourceSync),
      '프로그램 leaf 선택은 실행 source와 저장 draft를 함께 동기화해야 합니다.',
    );
    assertIncludesAll(appSource, ['sidebarCollapsedProjects: new Set()', 'sidebarCollapsedSources: new Set()']);
    assertIncludesAll(qualitySource, [
      'state.sidebarCollapsedProjects = new Set(',
      'Array.isArray(dashboard.sidebarCollapsedProjects)',
      'state.sidebarCollapsedSources = new Set(',
      'Array.isArray(dashboard.sidebarCollapsedSources)',
      'sidebarCollapsedProjects: [...(state.sidebarCollapsedProjects || [])]',
      'sidebarCollapsedSources: [...(state.sidebarCollapsedSources || [])]',
    ]);
    assertIncludesAll(sidebarStyles, [
      '.project-sidebar-project',
      '.project-sidebar-source',
      '.project-sidebar-source-list',
      '.project-sidebar-sessions',
      '.project-sidebar-session-more',
    ]);
    assert.match(
      messagesSource,
      /"studio\.sidebar\.more_source_sessions": \{"ko":"\+ \{count\}개 작업 더 있음","en":"[^"]+","zh-CN":"[^"]+"\}/,
      '남은 작업 수 요약은 한국어·영어·중국어에서 지역화해야 합니다.',
    );

    state.workspace = cwd;
    state.workspaceSource = 'builtin.opencode';
    assert.deepStrictEqual(
      Array.from(sessions.filter(dashboard.matchesWorkspaceFilter), session => session.id),
      ['builtin.opencode:open-root', 'builtin.opencode:open-child'],
    );
    state.workspaceSource = 'direct';
    assert.deepStrictEqual(
      Array.from(sessions.filter(dashboard.matchesWorkspaceFilter), session => session.id),
      ['direct-root', 'direct-root-2', 'direct-root-3', 'direct-root-4', 'direct-root-5'],
      '사이드바 preview 제한이 실제 프로젝트·source 필터 결과를 잘라내면 안 됩니다.',
    );

    state.workspace = '__projectless__';
    state.workspaceSource = 'builtin.aside';
    dashboard.renderWorkspaces();
    assert.equal(state.workspace, '__projectless__');
    assert.equal(state.workspaceSource, 'builtin.aside');
    const selectedProjectless = siblingBlock(sidebar.innerHTML, 'data-sidebar-project-key', projectlessKey);
    assert.ok(tagWith(selectedProjectless, 'data-project-source="builtin.aside"').includes('aria-selected="true"'),
      'Aside 프로젝트 없음 항목의 선택 상태가 다른 source로 새면 안 됩니다.');
    assert.deepStrictEqual(
      Array.from(sessions.filter(dashboard.matchesWorkspaceFilter), session => session.id),
      ['builtin.aside:aside-projectless'],
      '프로젝트 없음 필터도 source 경계를 유지해야 합니다.',
    );

    state.workspace = cwd;
    state.workspaceSource = 'builtin.aside';
    state.sourcePluginSettings.enabledPluginIds = ['builtin.opencode'];
    dashboard.renderWorkspaces();
    assert.equal(sidebar.innerHTML.includes('::builtin.aside"'), false);
    assert.ok(sidebar.innerHTML.includes(`data-sidebar-project-key="${projectKey}"`),
      '선택한 플러그인만 사라져도 다른 프로그램이 있는 프로젝트 자체는 유지해야 합니다.');
    assert.equal(state.workspace, cwd);
    assert.equal(state.workspaceSource, 'all',
      '선택 source만 사라지면 같은 프로젝트의 전체 프로그램 필터로 복구해야 합니다.');

    sessions.splice(0, sessions.length, ...sessions.filter(session => !session.originCwd));
    state.workspace = cwd;
    state.workspaceSource = 'all';
    dashboard.renderWorkspaces();
    assert.equal(sidebar.innerHTML.includes(`data-sidebar-project-key="${projectKey}"`), false);
    assert.equal(state.workspace, 'all');
    assert.equal(state.workspaceSource, 'all');

    state.workspaces = [{ name: '빈 저장 프로젝트', path: cwd }];
    state.workspace = cwd;
    state.workspaceSource = 'direct';
    dashboard.renderWorkspaces();
    const emptySavedProject = siblingBlock(sidebar.innerHTML, 'data-sidebar-project-key', projectKey);
    assert.ok(emptySavedProject.includes('빈 저장 프로젝트'),
      '작업이 없는 저장 프로젝트 자체는 프로젝트 목록에 남아야 합니다.');
    assert.equal((emptySavedProject.match(/data-sidebar-source-key=/g) || []).length, 0,
      '작업이 없는 저장 프로젝트 아래에 Whitebox 또는 플러그인 source 행을 만들면 안 됩니다.');
    assert.equal(emptySavedProject.includes(`data-sidebar-source-key="${sourceKey(projectKey, 'direct')}"`), false,
      '작업 0건인 Whitebox source 행이 저장 프로젝트 아래에 남으면 안 됩니다.');
    assert.equal(emptySavedProject.includes('data-sidebar-project-toggle'), false,
      'source가 없는 프로젝트에 빈 disclosure를 표시하면 안 됩니다.');
    assert.equal(emptySavedProject.includes('project-sidebar-source-list'), false,
      'source가 없는 프로젝트에 빈 source 컨테이너를 표시하면 안 됩니다.');
    assert.equal(emptySavedProject.includes('<small>'), false,
      '빈 저장 프로젝트에 0건 source 요약을 표시하면 안 됩니다.');
    assert.equal(state.workspace, cwd);
    assert.equal(state.workspaceSource, 'all',
      '사라진 direct source 선택은 저장 프로젝트 자체를 유지한 채 전체 source로 복구해야 합니다.');
  });

  test('플러그인 설정 응답은 응답 시점의 drawer 선택만 닫는다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-events-filters.js'), 'utf8');
    const dashboard = fs.readFileSync(path.join(root, 'renderer', 'app-dashboard.js'), 'utf8');
    const messages = fs.readFileSync(path.join(root, 'renderer', 'i18n-messages.js'), 'utf8');
    const handler = source.slice(
      source.indexOf('$("#sourcePluginSettingsList")?.addEventListener("change"'),
      source.indexOf('$("#providerVisibilityList").addEventListener("change"'),
    );
    const requestIndex = handler.indexOf('await window.whitebox.setSourcePluginEnabled');
    const selectedIndex = handler.indexOf('const selectedAfterChange =');
    assert.ok(requestIndex >= 0 && selectedIndex > requestIndex,
      '플러그인 저장 응답 후 현재 drawer 세션을 다시 확인해야 합니다.');
    assert.equal(handler.slice(0, requestIndex).includes('state.selectedId'), false,
      '요청 전 선택을 캡처하면 응답 중 이동한 drawer를 잘못 닫을 수 있습니다.');
    const selectedSourceFallback = /if \(!requestedEnabled && state\.workspaceSource === pluginId\) \{([\s\S]*?)\}/.exec(handler)?.[1] || '';
    assert.ok(selectedSourceFallback.includes('state.workspaceSource = "all";'),
      '비활성화된 source를 선택 중이면 같은 프로젝트의 전체 프로그램 필터로 복구해야 합니다.');
    assert.equal(selectedSourceFallback.includes('state.workspace = "all";'), false,
      'source 하나를 껐다는 이유만으로 아직 존재하는 프로젝트 선택까지 전역 전체로 지우면 안 됩니다.');
    assert.match(handler.slice(selectedIndex), /const projectedAfterChange = state\.rawSnapshot \? projectVisibleSnapshot\(state\.rawSnapshot\) : null;[\s\S]*projectedAfterChange\.sessions\.some\(\(session\) => session\.id === state\.selectedId\)[\s\S]*!selectedStillVisible\) closeDrawer\(\)/,
      '비활성화한 source의 새 투영에서 사라진 루트·하위 세션의 캐시된 drawer를 닫아야 합니다.');
    assert.match(handler, /const activationWarning = String\(result\.warning \|\| ""\)\.trim\(\);/);
    assert.match(handler, /activationWarning\s*\? "settings\.plugins\.activation_warning"\s*:\s*requestedEnabled/,
      '설정은 저장됐지만 refresh/restart가 실패한 응답을 일반 성공 토스트로 표시하면 안 됩니다.');
    assert.match(handler, /toast\(t\(toastKey, \{ plugin: label, detail: activationWarning \}\)\);/);
    assert.match(messages, /"settings\.plugins\.activation_warning": \{"ko":"[^"]+","en":"[^"]+","zh-CN":"[^"]+"\}/,
      '적용 지연과 재시작 필요를 안내할 한국어·영어·중국어 메시지가 없습니다.');
    const settingsRenderer = dashboard.slice(
      dashboard.indexOf('function renderSourcePluginSettings()'),
      dashboard.indexOf('\n  return {', dashboard.indexOf('function renderSourcePluginSettings()')),
    );
    assert.ok(settingsRenderer.includes('list.innerHTML = definitions.map((definition) => {'),
      '저장 실패 render는 브라우저가 바꾼 checked·disabled·busy 상태를 실제 DOM에서 복구해야 합니다.');
    assert.equal(settingsRenderer.includes('lastSourcePluginSettingsHtml'), false,
      'state 문자열만 비교하는 캐시는 실패한 플러그인 토글의 DOM 상태를 고착시킵니다.');
  });

  test('공용 날짜 포매터 캐시는 시스템 시간대 변경을 무효화한다', () => {
    const shared = fs.readFileSync(path.join(root, 'renderer', 'shared.js'), 'utf8');
    assert.ok(shared.includes('resolvedOptions().timeZone'));
    assert.ok(shared.includes('offset !== dateTimeFormatOffset'));
    assert.ok(shared.includes('dateTimeFormatCache.clear()'));
    assert.ok(shared.includes('window.addEventListener("focus", () => refreshDateTimeFormatZone(true))'));
    assert.ok(shared.includes('`${dateTimeFormatTimeZone}|${locale}|${JSON.stringify(options || {})}`'));

    let zone = 'UTC';
    let offset = 0;
    let now = 1_700_000_000_000;
    const focusListeners = [];
    class FakeDate extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
      getTimezoneOffset() { return offset; }
    }
    class FakeDateTimeFormat {
      constructor() { this.zone = zone; }
      resolvedOptions() { return { timeZone: this.zone }; }
      format() { return this.zone; }
    }
    const sandbox = {
      console,
      Date: FakeDate,
      Intl: { DateTimeFormat: FakeDateTimeFormat },
      document: {
        hidden: false,
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
      },
      window: {
        addEventListener(type, listener) {
          if (type === 'focus') focusListeners.push(listener);
        },
      },
    };
    vm.runInNewContext(shared, sandbox, { filename: 'shared.js' });
    const utc = sandbox.window.WhiteboxRendererUtils.dateTimeFormat('en-US', { hour: '2-digit' });
    assert.equal(utc.format(), 'UTC');

    zone = 'Asia/Seoul';
    offset = -540;
    const seoul = sandbox.window.WhiteboxRendererUtils.dateTimeFormat('en-US', { hour: '2-digit' });
    assert.equal(seoul.format(), 'Asia/Seoul');
    assert.notStrictEqual(seoul, utc);

    zone = 'Asia/Tokyo';
    now += 1_000;
    assert.strictEqual(
      sandbox.window.WhiteboxRendererUtils.dateTimeFormat('en-US', { hour: '2-digit' }),
      seoul,
      '같은 offset의 zone 변경은 강제 probe 전 기존 formatter를 재사용합니다.',
    );
    focusListeners[0]();
    assert.equal(
      sandbox.window.WhiteboxRendererUtils.dateTimeFormat('en-US', { hour: '2-digit' }).format(),
      'Asia/Tokyo',
    );
  });

  test('비활성 플러그인 실행 draft는 modal을 열 때 직접 실행으로 치유한다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-run-modal.js'), 'utf8');
    const normalization = source.slice(
      source.indexOf('function normalizeRunSourceSelection()'),
      source.indexOf('function sourcePickerHtml()'),
    );
    assertIncludesAll(normalization, [
      'sourcePluginEnabled(state.runSource)',
      'state.runSource = "direct";',
      'state.runDraft.sourcePluginId = "direct";',
      'context.saveRunDraft?.();',
    ]);
    const openModal = source.slice(source.indexOf('function openRunModal()'), source.indexOf('function closeRunModal('));
    const restoreIndex = openModal.indexOf('restoreRunDraft();');
    const normalizeIndex = openModal.indexOf('normalizeRunSourceSelection();');
    const pickerIndex = openModal.indexOf('ensureRunSourcePicker();');
    assert.ok(restoreIndex >= 0 && normalizeIndex > restoreIndex && pickerIndex > normalizeIndex,
      'draft 복원 후 source picker를 만들기 전에 비활성 source를 정규화해야 합니다.');
  });

  test('프로젝트 선택 화면은 진행 작업 정보 없이 선택 안내와 지속 모션만 제공한다', () => {
    const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'renderer', 'styles-studio-shell.css'), 'utf8');
    const themeStyles = fs.readFileSync(path.join(root, 'renderer', 'styles-theme.css'), 'utf8');
    const historyEmptyRule = styles.match(/\.project-history-list > \.project-history-empty\s*\{([^}]*)\}/)?.[1] || '';
    const selection = html.slice(html.indexOf('id="projectSelectionPrompt"'), html.indexOf('id="projectTaskToolbar"'));
    for (const contract of ['project-selection-visual', 'project-selection-direction', 'project-selection-orbit', 'project-selection-scan']) {
      assert.ok(selection.includes(contract), `${contract} 프로젝트 선택 안내 요소가 없습니다.`);
    }
    assert.equal(selection.includes('project-selection-flow'), false, '프로젝트 선택 전에는 진행 작업 안내를 표시하지 않아야 합니다.');
    assert.equal(html.includes('id="projectContextNav"'), false,
      '항목이 없은 프로젝트 탐색/추가 기능 영역은 빈 여백을 남기지 않고 제거되어야 합니다.');
    assert.match(historyEmptyRule, /grid-column:\s*1\s*\/\s*-1\s*;/, '지난 세션 빈 상태가 기록 그리드의 첫 열에만 갇혀 있습니다.');
    assert.match(historyEmptyRule, /align-content:\s*center\s*;/, '지난 세션 빈 상태의 문구 묶음이 세로 중앙에 정렬되지 않습니다.');
    assert.match(historyEmptyRule, /border:\s*1px\s+dashed/, '지난 세션 빈 상태의 경계가 주변 기록 카드와 구분되지 않습니다.');
    const messages = fs.readFileSync(path.join(root, 'renderer', 'i18n-messages.js'), 'utf8');
    assert.ok(messages.includes('아직 완료된 작업이 없습니다'), '지난 기록 빈 상태가 실행 중 작업까지 없다는 뜻으로 읽힙니다.');
    assert.ok(messages.includes('진행 중인 작업은 위에 표시되고'), '실행 중 작업과 완료 기록의 위치를 구분하는 안내가 없습니다.');
    for (const animation of ['project-selection-enter', 'project-selection-orbit', 'project-selection-float', 'project-selection-breathe', 'project-selection-scan', 'project-selection-point']) {
      assert.ok(styles.includes(`@keyframes ${animation}`), `${animation} 프로젝트 선택 모션이 없습니다.`);
    }
    assert.ok(
      styles.includes('@media (prefers-reduced-motion: reduce)')
        && styles.includes('.project-selection-eyebrow i'),
      '프로젝트 선택 모션은 감소 모션 환경에서 중단되어야 합니다.',
    );
  });

  test('지난 기록은 대기 상태를 포함하고 마지막 갱신 시각 최신순으로 표시한다', () => {
    const source = fs.readFileSync(path.join(root, 'renderer', 'app-dashboard.js'), 'utf8');
    const sandbox = { window: { WhiteboxAppFactories: {}, WhiteboxI18n: { t: key => key } }, Intl };
    vm.runInNewContext(source, sandbox, { filename: 'app-dashboard.js' });
    const sessions = [
      { id: 'claude:older', provider: 'claude', status: 'idle', updatedAt: '2026-08-06T03:00:00Z' },
      { id: 'claude:supplier-today', provider: 'claude', status: 'waiting', updatedAt: '2026-08-06T05:04:44Z' },
      { id: 'claude:running', provider: 'claude', status: 'running', updatedAt: '2026-08-06T06:00:00Z' },
    ];
    const state = { view: 'active', workspace: 'all', search: '', sort: 'recent', providerFilters: new Set(), workspaces: [], providers: [] };
    const dashboard = sandbox.window.WhiteboxAppFactories.createDashboard({ state, visibleSessions: () => sessions });
    assert.deepStrictEqual(Array.from(dashboard.filteredSessions(), session => session.id), ['claude:supplier-today', 'claude:older']);
    assert.equal(dashboard.isPastRecord(sessions[1]), true);
    assert.equal(dashboard.isPastRecord(sessions[2]), false);
  });

  test('설정 화면은 변경 가능한 항목만 읽기 쉬운 순서로 표시한다', () => {
    const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
    const themeStyles = fs.readFileSync(path.join(root, 'renderer', 'styles-theme.css'), 'utf8');
    const noviceStyles = fs.readFileSync(path.join(root, 'renderer', 'styles-novice.css'), 'utf8');
    const dashboard = fs.readFileSync(path.join(root, 'renderer', 'app-dashboard.js'), 'utf8');
    const settings = html.slice(html.indexOf('id="settingsSection"'), html.indexOf('id="terminalRuntimeMount"'));
    assert.equal(settings.includes('settings-meta-grid'), false, '설정과 무관한 설치 진단 정보가 다시 노출되면 안 됩니다.');
    assert.equal(settings.includes('settings-emblem'), false, '설정 제목에 의미 없는 장식이 다시 추가되면 안 됩니다.');
    assert.ok(settings.includes('id="currentVersion"'), '설정 화면에 현재 프로그램 버전 값이 없습니다.');
    assert.ok(settings.includes('data-i18n="ui.running_version"')
      && settings.includes('data-i18n-aria-label="ui.compare_running_and_latest_versions"'),
    '설정 화면이 업데이트 대상이 아니라 현재 실행 중인 프로그램 버전을 명확히 설명해야 합니다.');
    assert.ok(dashboard.includes('const runningCurrent = state.versions.app || update.currentVersion || "";')
      && dashboard.includes('const current = runningCurrent;')
      && dashboard.includes('const comparisonCurrent = update.currentVersionKnown === false'),
    '설치 대상 버전을 확인하지 못해도 현재 실행 중인 프로그램 버전은 숨기면 안 됩니다.');
    const hiddenNoviceSelectors = Array.from(noviceStyles.matchAll(/([^{}]+)\{[^{}]*display:\s*none;[^{}]*\}/g), match => match[1]);
    assert.equal(
      hiddenNoviceSelectors.some(selectors => selectors.includes('body[data-current-view="settings"] .version-route')),
      false,
      '일반 설정 화면에서 현재 프로그램 버전 비교 영역을 숨기면 안 됩니다.',
    );
    assert.equal(dashboard.includes('provider-visibility-name"><b>${esc(provider.label)}</b><small>'), false, 'AI 표시 설정에 제공사 부가 정보가 다시 노출되면 안 됩니다.');
    assert.ok(dashboard.includes('update.installMode === "automatic"'), '업데이트 안내가 자동 설치와 수동 설치를 구분해야 합니다.');
    assert.ok(dashboard.includes('ui.open_the_installer_and_follow_its_instructions_to_finish_updating'), '수동 업데이트에는 설치 파일 안내가 표시되어야 합니다.');
    assert.ok(
      themeStyles.includes('body[data-current-view="settings"] .topbar')
        && themeStyles.includes('body[data-current-view="settings"] .sidebar-projects')
        && themeStyles.includes('body[data-current-view="settings"] .project-sidebar-list')
        && themeStyles.includes('width: min(100%, 1040px);'),
      '설정 화면은 읽기 폭을 제한하면서 프로젝트와 작업 탐색 탭을 유지해야 합니다.',
    );
    const languageIndex = settings.indexOf('language-settings-card');
    const themeIndex = settings.indexOf('theme-settings-card');
    const sourcePluginIndex = settings.indexOf('source-plugin-settings-card');
    const providersIndex = settings.indexOf('provider-visibility-card');
    const updateIndex = settings.indexOf('id="updatePanel"');
    assert.ok(languageIndex < themeIndex && themeIndex < sourcePluginIndex && sourcePluginIndex < providersIndex && providersIndex < updateIndex,
      '설정 항목의 읽기 순서가 언어, 화면, 외부 도구, AI 목록, 업데이트 순이어야 합니다.');
    assert.match(
      themeStyles,
      /:is\([^)]*\.source-plugin-settings-card[^)]*\.provider-visibility-card[^)]*\)\s*\{\s*grid-column:\s*1\s*\/\s*-1;/s,
      '외부 도구 설정 카드가 데스크톱 설정 그리드의 절반 폭에 갇히면 안 됩니다.',
    );
    assertIncludesAll(themeStyles, [
      '.source-plugin-option,',
      '.source-plugin-settings-copy > span,',
      '.source-plugin-copy b,',
      '.source-plugin-copy small,',
      'body[data-current-view="settings"] .source-plugin-settings-card',
      'body[data-current-view="settings"] .source-plugin-toggle',
    ]);

    assert.equal(settings.includes('attentionPopupSettingsCard'), false,
      '삭제된 오른쪽 팝업 설정 카드가 설정 화면에 다시 노출되었습니다.');
    assert.equal(settings.includes('attentionPopupEnabled'), false,
      '삭제된 오른쪽 팝업 토글이 설정 화면에 다시 노출되었습니다.');
    assert.equal(html.includes('src="app-attention-popup-settings.js"'), false,
      '삭제된 오른쪽 팝업 설정 런타임을 renderer가 다시 로드하면 안 됩니다.');
  });

  test('AI 표시 설정은 기본값·저장값·세션과 tmux 투영을 일관되게 적용한다', () => {
    const source = [
      fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8'),
      fs.readFileSync(path.join(root, 'renderer', 'app-provider-visibility.js'), 'utf8'),
    ].join('\n');
    const values = new Map();
    const sandbox = {
      localStorage: {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
      },
      document: { documentElement: { dataset: {} } },
      window: {
        WhiteboxAppFactories: {},
        WhiteboxRendererUtils: {
          $: () => null, $$: () => [], esc: value => String(value), uiLocale: () => 'ko',
          providerLabel: value => value, reportRecoverableError: () => {},
        },
        matchMedia: () => ({ matches: false, addEventListener: () => {} }),
        WhiteboxI18n: { t: key => key },
      },
    };
    vm.runInNewContext(source, sandbox, { filename: 'app.js' });
    const core = sandbox.window.WhiteboxAppFactories.createCore({});
    Object.assign(core, sandbox.window.WhiteboxAppFactories.createProviderVisibility(core));
    core.state.providers = ['claude', 'codex', 'gemini', 'grok'].map(id => ({ id }));
    core.loadProviderVisibility();
    assert.deepStrictEqual(Array.from(core.state.hiddenProviders), []);
    core.setProviderVisible('claude', false);
    assert.deepStrictEqual(JSON.parse(values.get(core.PROVIDER_VISIBILITY_STORAGE_KEY)), { hidden: ['claude'] });
    core.state.rawSnapshot = {
      sessions: [
        { id: 'hidden', provider: 'claude', status: 'waiting', usage: { total: 10 } },
        { id: 'shown', provider: 'codex', status: 'running', usage: { total: 20 } },
        { id: 'disabled-plugin', provider: 'codex', sourcePluginId: 'builtin.opencode', status: 'running', usage: { total: 900 } },
      ],
      summary: { providers: [{ id: 'claude', sessions: 1, active: 0, usage: { total: 10 } }, { id: 'codex', sessions: 2, active: 2, usage: { total: 920 } }] },
      tmux: { distros: [{ id: 'd', sessions: [{ id: 's', windows: [{ id: 'w', panes: [
        { id: 'hidden-pane', agent: { provider: 'claude' } },
        { id: 'shown-pane', agent: { provider: 'codex', linkedSessionId: 'shown' } },
        { id: 'shell-pane', agent: null },
      ] }] }] }] },
    };
    const projected = core.projectVisibleSnapshot(core.state.rawSnapshot);
    assert.deepStrictEqual(Array.from(projected.sessions, session => session.id), ['shown']);
    assert.deepStrictEqual(
      Array.from(projected.tmux.distros[0].sessions[0].windows[0].panes, pane => pane.id),
      ['shown-pane', 'shell-pane'],
    );
    assert.equal(projected.summary.totals.active, 1);
    assert.equal(projected.summary.totals.waiting, 0);
    assert.equal(projected.summary.providers.find(provider => provider.id === 'codex').sessions, 1);
    assert.equal(projected.summary.providers.find(provider => provider.id === 'codex').active, 1);
    assert.equal(projected.summary.providers.find(provider => provider.id === 'codex').usage.total, 20);
    assert.equal(projected.tmux.summary.aiPanes, 1);
    const desktopSession = {
      id: 'desktop-history', provider: 'codex', clientKind: 'codex-desktop', status: 'completed', usage: { total: 30 },
    };
    const desktopChild = {
      id: 'desktop-history-child', parentId: desktopSession.id, provider: 'codex', clientKind: 'codex-cli', status: 'completed', usage: { total: 5 },
    };
    assert.equal(core.desktopSourcePluginId(desktopSession), 'builtin.codex-desktop');
    assert.equal(core.isDesktopSessionVisible(desktopSession), true);
    assert.equal(core.isSourcePluginVisible('builtin.omo'), false, 'OpenCode 비활성화는 OMO alias에도 적용되어야 합니다.');
    core.state.sourcePluginSettings = { version: 3, enabledPluginIds: ['builtin.claude-desktop'], asideHistoryFolders: [] };
    assert.equal(core.isDesktopSessionVisible(desktopSession), false);
    const desktopHidden = core.projectVisibleSnapshot({
      ...core.state.rawSnapshot,
      sessions: [...core.state.rawSnapshot.sessions, desktopChild, desktopSession],
    });
    assert.equal(desktopHidden.sessions.some(session => session.id === desktopSession.id), false,
      '명시적으로 끈 데스크톱 기록은 raw snapshot과 detail 캐시에 남아 있어도 투영에서 숨겨야 합니다.');
    assert.equal(desktopHidden.sessions.some(session => session.id === desktopChild.id), false,
      '숨겨진 데스크톱 기록의 하위 세션을 고아 루트로 다시 표시하면 안 됩니다.');
    core.loadProviderVisibility({ hidden: ['gemini', 'unknown'] });
    assert.deepStrictEqual(Array.from(core.state.hiddenProviders), ['gemini']);
  });

}

function registerLegacyNameTests(context) {
  const { test, root } = context;
  test('제품 소스에 이전 워크플로우 명칭이 남아 있지 않다', () => {
    const forbidden = new RegExp(['w', 'c', 'c'].join(''), 'i');
    const visit = target => {
      const full = path.join(root, target);
      if (!fs.existsSync(full)) return;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(full)) visit(path.join(target, name));
      } else if (/\.(js|json|html|css|md)$/i.test(full)) {
        assert.equal(forbidden.test(fs.readFileSync(full, 'utf8')), false, `${target}에 제거 대상 명칭이 남아 있습니다.`);
      }
    };
    LEGACY_NAME_TARGETS.forEach(visit);
  });

  test('제품 소스와 파일명에 이전 프로그램 명칭이 남아 있지 않다', () => {
    const forbidden = new RegExp(['lode', 'star'].join(''), 'i');
    const visit = target => {
      const full = path.join(root, target);
      if (!fs.existsSync(full)) return;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(full)) {
          assert.equal(forbidden.test(name), false, `${path.join(target, name)} 파일명에 이전 프로그램 명칭이 남아 있습니다.`);
          visit(path.join(target, name));
        }
      } else if (/\.(js|json|ya?ml|html|css|md)$/i.test(full)) {
        assert.equal(forbidden.test(fs.readFileSync(full, 'utf8')), false, `${target}에 이전 프로그램 명칭이 남아 있습니다.`);
      }
    };
    PRODUCT_NAME_TARGETS.forEach(visit);
  });

}

function registerDocumentationContractTests(context) {
  const { test, root } = context;
  test('UI 전수 점검 장부는 기존 항목을 제외해 1–300 완료 항목을 정확히 기록한다', () => {
    const auditFiles = [
      ['UI-AUDIT-100.md', 1],
      ['UI-AUDIT-101-200.md', 101],
      ['UI-AUDIT-201-300.md', 201],
    ];
    const allItems = [];
    for (const [file, start] of auditFiles) {
      const source = fs.readFileSync(path.join(root, 'docs', file), 'utf8');
      const items = [...source.matchAll(/^(\d+)\. \[x\]/gm)].map(match => Number(match[1]));
      assert.equal(items.length, 100, `${file} 완료 항목이 100개가 아닙니다.`);
      assert.deepStrictEqual(items, Array.from({ length: 100 }, (_, index) => start + index), `${file} 번호가 예상 범위와 다릅니다.`);
      assert.equal(source.includes('[ ]'), false, `${file}에 검증되지 않은 UI 점검 항목이 남아 있습니다.`);
      allItems.push(...items);
    }
    assert.equal(allItems.length, 300, '전체 UI 점검 장부 완료 항목이 300개가 아닙니다.');
    assert.equal(new Set(allItems).size, 300, 'UI 점검 항목 번호가 겹칩니다.');
  });

  test('README와 릴리스 워크플로가 npm·Windows·macOS 실행 경로를 안내한다', () => {
    for (const file of ['README.md', 'README.ko.md', 'README.zh-CN.md']) {
      const readme = fs.readFileSync(path.join(root, file), 'utf8');
      for (const contract of [
        'npm install -g whitebox-ai',
        'whitebox',
        'https://github.com/minjund/Whitebox/releases/latest',
        'Whitebox-Setup-<version>.exe',
        'Whitebox-<version>-portable.exe',
        'Whitebox-<version>-arm64.dmg',
        'Whitebox-<version>-x64.dmg',
      ]) assert.ok(readme.includes(contract), `${file}에 ${contract} 안내가 없습니다.`);
    }

    const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
    for (const contract of RELEASE_WORKFLOW_CONTRACTS) {
      assert.ok(workflow.includes(contract), `release.yml에 ${contract} 계약이 없습니다.`);
    }
    const desktopWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'desktop-ci.yml'), 'utf8');
    assert.ok(desktopWorkflow.includes('npm run test:drawer-conversation'), 'Desktop CI가 대화창 터미널 회귀 검사를 실행해야 합니다.');
    assert.ok(desktopWorkflow.includes("if: runner.os == 'Windows'"), '대화창 Electron 검사는 Windows fixture에서 실행해야 합니다.');
    assert.equal(workflow.includes('continue-on-error'), false, 'npm 게시 실패를 성공으로 숨기면 안 됩니다.');
    assert.equal(workflow.includes('NODE_AUTH_TOKEN'), false, 'npm 게시는 장기 토큰 대신 OIDC Trusted Publisher를 사용해야 합니다.');
  });
}

function registerUiContractSuite(context) {
  registerSyntaxContractTests(context);
  registerUiContractTests(context);
  registerLegacyNameTests(context);
  registerDocumentationContractTests(context);
}

module.exports = { registerUiContractSuite };
