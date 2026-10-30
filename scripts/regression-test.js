'use strict';

const path = require('path');
const { registerAgentParserTests } = require('./tests/agent-parsers');
const { registerCoreUpdateWorkspaceTests } = require('./tests/core-update-workspace');
const { createRegressionFixtures } = require('./tests/fixtures');
const { createTestHarness } = require('./tests/harness');
const { registerRuntimeTerminalBridgeTests } = require('./tests/runtimes-terminal-bridge');
const { registerAttentionNotifierTests } = require('./tests/attention-notifier');
const { registerAutomationMonitorTests } = require('./tests/automation-monitor');
const { registerSessionIntelligenceTests } = require('./tests/session-intelligence');
const { registerTerminalInteractionTests } = require('./tests/terminal-interactions');
const { registerTerminalPromptTests } = require('./tests/terminal-prompts');
const { registerAgentRunnerLifecycleTests } = require('./tests/agent-runner-lifecycle');
const { registerUpdateDownloadLimitTests } = require('./tests/update-download-limits');
const { registerTmuxControlProxyLifecycleTests } = require('./tests/tmux-control-proxy-lifecycle');
const { registerTerminalBoundConversationTests } = require('./tests/terminal-bound-conversation');
const { registerBridgeBackpressureTests } = require('./tests/bridge-backpressure');
const { registerAttentionActivationTests } = require('./tests/attention-activation');
const { registerAttentionHookTests } = require('./tests/attention-hook');
const { registerStructuredInputRequestTests } = require('./tests/structured-input-request');
const { registerSourcePluginTests } = require('./tests/source-plugins');
const { registerSourcePluginActivationTests } = require('./tests/source-plugin-activation');
const { registerCodexSharedAppServerTests } = require('./tests/codex-shared-app-server');
const { registerBrandMigrationTests } = require('./tests/brand-migration');
const { registerComprehensionPacketTests } = require('./tests/comprehension-packet');
const { registerComprehensionParserProjectionTests } = require('./tests/comprehension-parser-projection');

const root = path.resolve(__dirname, '..');
const fixtures = createRegressionFixtures(root);
const harness = createTestHarness();
const context = { ...fixtures, test: harness.test };
require('./tests/update-workload-scope').registerUpdateWorkloadScopeTests(context);
require('./tests/pty-recovery').registerPtyRecoveryTests(context);
require('./tests/terminal-host-runtime').registerTerminalHostRuntimeTests(context);
require('./tests/terminal-host-timeout').registerTerminalHostTimeoutTests(context);
require('./tests/window-focus-policy').registerWindowFocusPolicyTests(context);
require('./tests/monitor-state-latency').registerMonitorStateLatencyTests(context);
require('./tests/process-monitor-async').registerProcessMonitorAsyncTests(context);
require('./tests/terminal-collaboration-performance').registerTerminalCollaborationPerformanceTests(context);
require('./tests/performance-regressions').registerPerformanceRegressionTests(context);
require('./tests/packaged-update-driver').registerPackagedUpdateDriverTests(context);
require('./tests/windows-update-shards').registerWindowsUpdateShardTests(context);

registerCoreUpdateWorkspaceTests(context);
registerAttentionNotifierTests(context);
require('./tests/attention-project').registerAttentionProjectTests(context);
require('./tests/attention-popup-manager').registerAttentionPopupManagerTests(context);
registerAutomationMonitorTests(context);
registerSessionIntelligenceTests(context);
registerTerminalInteractionTests(context);
registerTerminalPromptTests(context);
registerAgentRunnerLifecycleTests(context);
registerUpdateDownloadLimitTests(context);
registerTmuxControlProxyLifecycleTests(context);
registerTerminalBoundConversationTests(context);
registerBridgeBackpressureTests(context);
registerAttentionActivationTests(context);
registerAttentionHookTests(context);
registerStructuredInputRequestTests(context);
registerSourcePluginTests(context);
registerSourcePluginActivationTests(context);
registerCodexSharedAppServerTests(context);
require('./tests/terminal-startup-recovery').registerTerminalStartupRecoveryTests(context);
registerBrandMigrationTests(context);
registerComprehensionPacketTests(context);
registerComprehensionParserProjectionTests(context);
require('./tests/background-questionnaire').registerBackgroundQuestionnaireTests(context);
require('./tests/questionnaire-preference').registerQuestionnairePreferenceTests(context);
registerAgentParserTests(context);
require('./tests/claude-agent-termination').registerClaudeAgentTerminationTests(context);
registerRuntimeTerminalBridgeTests(context);




harness.run({ cleanup: fixtures.cleanup }).catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
