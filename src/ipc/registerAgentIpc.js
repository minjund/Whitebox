'use strict';

function registerAgentIpc({ handleTrusted, snapshot, requestDetail, retryQuestionnaire = () => ({ ok: false }), runner, isProviderVisible = () => true, probeProviders }) {
  handleTrusted('agents:snapshot', snapshot);
  handleTrusted('agents:detail', requestDetail);
  handleTrusted('agents:retry-questionnaire', retryQuestionnaire);
  handleTrusted('agents:run', options => {
    if (!isProviderVisible(options && options.provider)) throw new Error('설정에서 숨긴 AI는 실행할 수 없습니다.');
    return runner().start(options);
  });
  handleTrusted('agents:stop', runId => runner().stop(runId));
  handleTrusted('agents:pause', runId => runner().pause(runId));
  handleTrusted('agents:resume-run', runId => runner().resume(runId));
  handleTrusted('agents:retry', runId => runner().retry(runId));
  handleTrusted('agents:active-runs', () => runner().listVisibleActive().filter(run => isProviderVisible(run.provider)));
  handleTrusted('providers:probe', probeProviders);
}

module.exports = { registerAgentIpc };
