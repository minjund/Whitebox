"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

window.WhiteboxAppFactories.createEventBindings = function createEventBindings(context = {}) {
  const { bindNavigationAndUpdateEvents, bindSessionAndAgentEvents, bindFilterAndWorkspaceEvents, bindDialogAndGlobalEvents, bindQualityEvents = () => {}, bindPtyFocusEvents = () => {} } = context;

  function bindEvents() {
    bindNavigationAndUpdateEvents();
    bindSessionAndAgentEvents();
    bindPtyFocusEvents();
    bindFilterAndWorkspaceEvents();
    bindDialogAndGlobalEvents();
    bindQualityEvents();
  }

  return { bindEvents };
};
