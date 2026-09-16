"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

window.WhiteboxAppFactories.createFilterEventBindings = function createFilterEventBindings(context = {}) {
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const { $, state, setProviderVisible = () => {}, isSourcePluginVisible = () => true, isDesktopSessionVisible = () => true, projectVisibleSnapshot = snapshot => snapshot, visibleSnapshot = () => state.snapshot, closeDrawer = () => {}, openDrawer = () => {}, openRunModal = () => {}, syncRunComposer = () => {}, saveRunDraft = () => {}, renderSessions, render, renderWorkspaces, renderGlobalStats = () => {}, renderProviderOverview, renderProviderFilter, toggleProviderFilter, announceProviderFilter, filteredSessions, resultReviewTargets = () => [], performUiAction, toast, announce, selectView = () => {}, selectViewFromUser = selectView, normalizedSearch = (value) => String(value || "").trim(), saveDashboardPreferences = () => {}, saveProjectDismissals = () => {}, moveProjectOrder = () => false, acknowledgeProjectNotices = () => 0, syncControlRoomDisclosureButtons = () => {}, preconnectProjectAgentTerminals = () => Promise.resolve([]) } = context;

  let sidebarProjectDragEndedAt = 0;

  function preconnectSelectedWorkspace() {
    if (String(state.workspaceSource || "all").startsWith("builtin.")) return;
    try {
      void Promise.resolve(preconnectProjectAgentTerminals(state.workspace)).catch((error) => {
        window.WhiteboxRendererUtils.reportRecoverableError("project-pty-preconnect-event", error);
      });
    } catch (error) {
      window.WhiteboxRendererUtils.reportRecoverableError("project-pty-preconnect-event", error);
    }
  }

  function bindFilterAndWorkspaceEvents() {
    const normalizedProjectPath = value => String(value || "")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .toLocaleLowerCase();
    const syncFilterResetButton = () => {
      const hasFilters = Boolean(
        $("#searchInput").value || state.search || state.providerFilters.size || state.workspace !== "all" || state.sort !== "recent" || state.controlRoomSort !== "recent",
      );
      $("#resetFiltersBtn").classList.toggle("hidden", !hasFilters);
    };
    const setRovingTreeItem = (container, item) => {
      if (!container || !item) return;
      container.querySelectorAll('[role="treeitem"]').forEach((candidate) => {
        candidate.tabIndex = candidate === item ? 0 : -1;
      });
    };
    const moveFocus = (event, container, selector, previousKeys, nextKeys, { wrap = true, roving = false } = {}) => {
      if (![...previousKeys, ...nextKeys, "Home", "End"].includes(event.key)) return false;
      const items = Array.from(container.querySelectorAll(selector)).filter((item) => (
        !item.disabled && !item.hidden && !item.closest("[hidden]")
      ));
      if (!items.length) return false;
      const current = Math.max(0, items.indexOf(event.target.closest(selector)));
      const requested = event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : current + (nextKeys.includes(event.key) ? 1 : -1);
      const next = wrap
        ? (requested + items.length) % items.length
        : Math.max(0, Math.min(items.length - 1, requested));
      event.preventDefault();
      if (roving) setRovingTreeItem(container, items[next]);
      items[next].focus();
      return true;
    };
    const bindSortableSidebarProjects = (container) => {
      if (!container) return;
      const selector = ".project-sidebar-group[data-project-sortable]";
      let draggedProjectId = "";
      const projectId = (node) => String(node?.dataset.projectSortable || "");
      const clearDropState = () => {
        container.querySelectorAll(selector).forEach((group) => {
          group.classList.remove("project-sort-dragging");
          group.removeAttribute("data-project-drop-edge");
          group.querySelector(".project-sidebar-item[aria-grabbed]")?.setAttribute("aria-grabbed", "false");
        });
      };
      const finishDrag = () => {
        const completedDrag = Boolean(draggedProjectId);
        clearDropState();
        draggedProjectId = "";
        if (completedDrag) sidebarProjectDragEndedAt = Date.now();
      };
      const commitPosition = (sourceId, targetId, placeAfter, focusSource = false) => {
        if (!moveProjectOrder(sourceId, targetId, placeAfter)) return false;
        saveDashboardPreferences();
        renderWorkspaces();
        renderSessions("reorder");
        announce(t("project.position_changed"));
        if (focusSource) requestAnimationFrame(() => container
          .querySelector(`${selector}[data-project-sortable="${CSS.escape(sourceId)}"] .project-sidebar-item`)
          ?.focus({ preventScroll: true }));
        return true;
      };
      container.addEventListener("dragstart", (event) => {
        // The folder icon starts a move; the name remains a selection target.
        const handle = event.target.closest(".project-sidebar-drag-handle[draggable='true']");
        const group = handle?.closest(selector);
        const item = group?.querySelector(".project-sidebar-item");
        if (!group || !item || event.target.closest("[data-remove-workspace]")) return;
        draggedProjectId = projectId(group);
        if (!draggedProjectId) {
          event.preventDefault();
          return;
        }
        group.classList.add("project-sort-dragging");
        item.setAttribute("aria-grabbed", "true");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", draggedProjectId);
          event.dataTransfer.setData("application/x-whitebox-project-sidebar", container.id);
          event.dataTransfer.setDragImage(item, 20, 20);
        }
      });
      container.addEventListener("dragover", (event) => {
        if (!draggedProjectId) return;
        const target = event.target.closest(selector);
        if (!target || projectId(target) === draggedProjectId) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        container.querySelectorAll(`${selector}[data-project-drop-edge]`).forEach((group) => group.removeAttribute("data-project-drop-edge"));
        const bounds = target.getBoundingClientRect();
        target.dataset.projectDropEdge = event.clientY > bounds.top + bounds.height / 2 ? "bottom" : "top";
      });
      container.addEventListener("drop", (event) => {
        if (!draggedProjectId) return;
        const target = event.target.closest(selector);
        if (!target || projectId(target) === draggedProjectId) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = target.getBoundingClientRect();
        const changed = commitPosition(
          draggedProjectId,
          projectId(target),
          event.clientY > bounds.top + bounds.height / 2,
        );
        finishDrag();
        if (!changed) clearDropState();
      });
      container.addEventListener("dragend", finishDrag);
      container.addEventListener("dragleave", (event) => {
        if (!container.contains(event.relatedTarget)) clearDropState();
      });
      container.addEventListener("keydown", (event) => {
        const item = event.target.closest(".project-sidebar-item[aria-grabbed]");
        if (!item || event.target !== item || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        const group = item.closest(selector);
        const groups = Array.from(container.querySelectorAll(selector));
        const current = groups.indexOf(group);
        const offset = event.key === "ArrowUp" ? -1 : 1;
        const target = groups[current + offset];
        if (current < 0 || !target) return;
        event.preventDefault();
        event.stopPropagation();
        commitPosition(projectId(group), projectId(target), offset > 0, true);
      });
    };
    $("#loadMoreBtn").addEventListener("click", () => {
      const previousCount = document.querySelectorAll("#sessionGrid [data-session-id]").length;
      state.visibleLimit += 30;
      renderSessions("load-more");
      const cards = document.querySelectorAll("#sessionGrid [data-session-id]");
      cards[Math.min(previousCount, cards.length - 1)]?.focus({ preventScroll: true });
      announce(window.WhiteboxI18n.t("filter.more_loaded", { count: Math.max(0, cards.length - previousCount) }));
    });
    const workspaceLists = [$("#workspaceList"), $("#projectSidebarList")].filter(Boolean);
    const selectSidebarTaskWorkspace = (trigger) => {
      const project = trigger.closest(".project-sidebar-project")?.querySelector(".project-sidebar-item[data-workspace]");
      if (!project) return;
      state.workspace = project.dataset.workspace;
      state.workspaceSource = "all";
      state.visibleLimit = 30;
      renderWorkspaces();
      if (state.view !== "all") selectViewFromUser("all", { motionKind: "filter" });
      else renderSessions("filter");
      syncFilterResetButton();
    };
    const sidebarMenu = $("#projectSidebarMenu");
    let menuProjectKey = "";
    const showSidebarMenu = (trigger) => {
      const group = trigger.closest(".project-sidebar-project");
      if (!group || !sidebarMenu) return;
      menuProjectKey = group.dataset.sidebarProjectKey;
      const groups = [...$("#projectSidebarList").querySelectorAll("[data-project-sortable]")];
      const index = groups.indexOf(group);
      sidebarMenu.querySelector('[data-sidebar-menu-action="up"]').disabled = index <= 0;
      sidebarMenu.querySelector('[data-sidebar-menu-action="down"]').disabled = index < 0 || index === groups.length - 1;
      sidebarMenu.querySelector('[data-sidebar-menu-action="remove"]').hidden = !group.querySelector("[data-remove-workspace]");
      sidebarMenu.showPopover();
      const bounds = trigger.getBoundingClientRect();
      sidebarMenu.style.left = Math.max(8, Math.min(bounds.right - sidebarMenu.offsetWidth, window.innerWidth - sidebarMenu.offsetWidth - 8)) + "px";
      sidebarMenu.style.top = Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - sidebarMenu.offsetHeight - 8)) + "px";
      sidebarMenu.querySelector('button:not(:disabled):not([hidden])')?.focus();
    };
    sidebarMenu?.addEventListener("click", event => {
      const action = event.target.closest("[data-sidebar-menu-action]")?.dataset.sidebarMenuAction;
      if (!action) return;
      const group = $("#projectSidebarList")?.querySelector(`[data-sidebar-project-key="${CSS.escape(menuProjectKey)}"]`);
      sidebarMenu.hidePopover();
      if (!group) return;
      if (action === "remove") { group.querySelector("[data-remove-workspace]")?.click(); return; }
      const groups = [...$("#projectSidebarList").querySelectorAll("[data-project-sortable]")];
      const index = groups.indexOf(group);
      const target = groups[index + (action === "up" ? -1 : 1)];
      if (index < 0 || !target || !moveProjectOrder(menuProjectKey, target.dataset.projectSortable, action === "down")) return;
      saveDashboardPreferences();
      renderWorkspaces();
      renderSessions("reorder");
      announce(t("project.position_changed"));
      $("#projectSidebarList")?.querySelector(`[data-sidebar-project-key="${CSS.escape(menuProjectKey)}"] .project-sidebar-item`)?.focus();
    });
    sidebarMenu?.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        sidebarMenu.hidePopover();
        $("#projectSidebarList")?.querySelector(`[data-sidebar-project-key="${CSS.escape(menuProjectKey)}"] .project-sidebar-item`)?.focus();
      } else moveFocus(event, sidebarMenu, 'button:not([hidden])', ["ArrowUp"], ["ArrowDown"]);
    });
    $("#sidebarProjectSearch")?.addEventListener("input", event => {
      state.sidebarProjectSearch = event.currentTarget.value;
      renderWorkspaces();
    });
    $("#sidebarProjectSearch")?.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.currentTarget.value = "";
        state.sidebarProjectSearch = "";
        renderWorkspaces();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        $("#projectSidebarList")?.querySelector('[role="treeitem"]')?.focus();
      }
    });
    $("#sidebarCollapseAllBtn")?.addEventListener("click", () => {
      state.sidebarExpandedProjects?.clear();
      renderWorkspaces();
      saveDashboardPreferences();
      announce(t("studio.sidebar.collapse_all"));
    });
    const handleWorkspaceClick = async (event) => {
      const activeList = event.currentTarget;
      if (activeList.id === "projectSidebarList" && Date.now() - sidebarProjectDragEndedAt < 250) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const menuTrigger = event.target.closest("[data-sidebar-project-menu]");
      if (menuTrigger) { showSidebarMenu(menuTrigger); return; }
      const projectToggle = activeList.id === "projectSidebarList"
        ? event.target.closest("[data-sidebar-project-toggle]")
        : null;
      if (projectToggle) {
        event.preventDefault();
        event.stopPropagation();
        const projectKey = String(projectToggle.dataset.sidebarProjectToggle || "");
        if (!projectKey) return;
        if (!(state.sidebarExpandedProjects instanceof Set)) state.sidebarExpandedProjects = new Set();
        if (state.sidebarExpandedProjects.has(projectKey)) state.sidebarExpandedProjects.delete(projectKey);
        else state.sidebarExpandedProjects.add(projectKey);
        const announcement = projectToggle.getAttribute("aria-label") || "";
        renderWorkspaces();
        saveDashboardPreferences();
        requestAnimationFrame(() => activeList.querySelector(`[data-sidebar-project-key="${CSS.escape(projectKey)}"] .project-sidebar-item[role="treeitem"]`)
          ?.focus({ preventScroll: true }));
        if (announcement) announce(announcement);
        return;
      }
      const inlinePty = activeList.id === "projectSidebarList"
        ? event.target.closest("[data-pty-focus-trigger]")
        : null;
      if (inlinePty) {
        // A sidebar task opens its project workspace with the PTY attached —
        // the same gesture as pressing PTY on the agent node — instead of the
        // side drawer.
        event.preventDefault();
        event.stopPropagation();
        selectSidebarTaskWorkspace(inlinePty);
        await openDrawer(inlinePty.dataset.ptyFocusTrigger, { trigger: inlinePty, focus: true });
        saveDashboardPreferences();
        return;
      }
      const openSession = activeList.id === "projectSidebarList"
        ? event.target.closest("[data-open-session]")
        : null;
      if (openSession) {
        selectSidebarTaskWorkspace(openSession);
        openDrawer(openSession.dataset.openSession);
        saveDashboardPreferences();
        return;
      }
      const remove = event.target.closest("[data-remove-workspace]");
      if (remove) {
        event.stopPropagation();
        const path = remove.dataset.removeWorkspace;
        const workspaceItems = Array.from(activeList.querySelectorAll("[data-workspace]"));
        const workspaceRow = remove.closest(".workspace-row, .project-sidebar-group");
        const workspaceIndex = Math.max(0, workspaceItems.indexOf(workspaceRow?.querySelector("[data-workspace]")));
        const workspaces = await performUiAction(() => window.whitebox.removeWorkspace(remove.dataset.removeWorkspace), t("workspace.remove_failed"), remove);
        if (!workspaces) return;
        state.workspaces = workspaces;
        state.dismissedProjects.add(normalizedProjectPath(path));
        saveProjectDismissals();
        if (state.workspace === remove.dataset.removeWorkspace) {
          state.workspace = "all";
          state.workspaceSource = "all";
        }
        render();
        preconnectSelectedWorkspace();
        syncFilterResetButton();
        saveDashboardPreferences();
        requestAnimationFrame(() => {
          const nextItems = Array.from(activeList.querySelectorAll("[data-workspace]"));
          nextItems[Math.min(workspaceIndex, nextItems.length - 1)]?.focus();
        });
        announce(window.WhiteboxI18n.t("quality.workspace_removed", { name: path.split(/[\\/]/).filter(Boolean).pop() || path }));
        return;
      }
      const item = event.target.closest("[data-workspace], [data-source-workspace]");
      if (item) {
        // Selection and disclosure are separate: clicking a name always selects.
        const requestedWorkspace = item.dataset.workspace || item.dataset.sourceWorkspace;
        const requestedSource = activeList.id === "projectSidebarList" ? "all" : item.dataset.projectSource || "all";
        const canToggleToAll = activeList.id !== "projectSidebarList";
        const toggleToAll = canToggleToAll && requestedWorkspace !== "all"
          && state.workspace === requestedWorkspace
          && String(state.workspaceSource || "all") === requestedSource;
        state.workspace = toggleToAll ? "all" : requestedWorkspace;
        state.workspaceSource = toggleToAll || requestedWorkspace === "all" ? "all" : requestedSource;
        if (activeList.id === "projectSidebarList") {
          acknowledgeProjectNotices(requestedWorkspace, requestedSource);
        }
        const label = state.workspace === "all"
          ? t("project.all")
          : item.querySelector("strong")?.textContent.trim()
            || item.getAttribute("aria-label")
            || t("project.all");
        state.visibleLimit = 30;
        renderWorkspaces();
        renderGlobalStats();
        if (activeList.id === "projectSidebarList" && state.view !== "all") selectViewFromUser("all", { motionKind: "filter" });
        else renderSessions("filter");
        preconnectSelectedWorkspace();
        if (activeList.id === "projectSidebarList" && state.workspace !== "all") {
          const selectedFlow = $("#liveSessionGrid")?.querySelector(".control-room-project-group");
          if (selectedFlow) {
            selectedFlow.open = true;
            if (selectedFlow.dataset.disclosureKey) state.disclosureStates.set(selectedFlow.dataset.disclosureKey, true);
            syncControlRoomDisclosureButtons();
          }
        }
        syncFilterResetButton();
        saveDashboardPreferences();
        announce(t("filter.workspace_results", { project: label, count: filteredSessions().length }));
        if (activeList.id === "projectSidebarList") {
          document.querySelector(".main-stage")?.scrollTo({ top: 0, behavior: "auto" });
          requestAnimationFrame(() => {
            const result = $("#liveSessionGrid")?.querySelector("[data-graph-focus], [data-open-session], .control-project-header");
            result?.focus({ preventScroll: true });
            if (document.activeElement !== result) $("#mainContent")?.focus({ preventScroll: true });
          });
        }
      }
    };
    bindSortableSidebarProjects($("#projectSidebarList"));
    workspaceLists.forEach((list) => {
      list.addEventListener("click", handleWorkspaceClick);
      if (list.id === "projectSidebarList") {
        list.addEventListener("focusin", (event) => {
          const treeItem = event.target.closest('[role="treeitem"]');
          if (treeItem && list.contains(treeItem)) setRovingTreeItem(list, treeItem);
        });
      }
      list.addEventListener("keydown", (event) => {
        if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) return;
        if (event.currentTarget.id === "projectSidebarList" && event.key === "Delete") {
          const treeItem = event.target.closest('[role="treeitem"][aria-level="1"]');
          const remove = treeItem?.closest(".project-sidebar-project")?.querySelector("[data-remove-workspace]");
          if (!remove) return;
          event.preventDefault();
          event.stopPropagation();
          remove.click();
          return;
        }
        if (event.currentTarget.id === "projectSidebarList" && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
          const trigger = event.target.closest(".project-sidebar-project")?.querySelector("[data-sidebar-project-menu]");
          if (trigger) { event.preventDefault(); showSidebarMenu(trigger); }
          return;
        }
        if (event.currentTarget.id === "projectSidebarList" && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
          const tree = event.currentTarget;
          const treeItem = event.target.closest('[role="treeitem"]');
          if (!treeItem) return;
          event.preventDefault();
          event.stopPropagation();
          const level = Number(treeItem.getAttribute("aria-level") || 0);
          const expanded = treeItem.getAttribute("aria-expanded");
          const ownedGroupId = treeItem.getAttribute("aria-owns") || "";
          const rememberTreeItem = () => ({
            level,
            projectRef: String(treeItem.dataset.sidebarProjectRef || ""),
            sourceRef: String(treeItem.dataset.sidebarSourceRef || ""),
            sessionId: String(treeItem.dataset.sidebarSessionId || ""),
          });
          const focusRememberedTreeItem = (identity) => requestAnimationFrame(() => {
            const target = Array.from(tree.querySelectorAll('[role="treeitem"]')).find((candidate) => (
              Number(candidate.getAttribute("aria-level") || 0) === identity.level
              && String(candidate.dataset.sidebarProjectRef || "") === identity.projectRef
              && String(candidate.dataset.sidebarSourceRef || "") === identity.sourceRef
              && String(candidate.dataset.sidebarSessionId || "") === identity.sessionId
            ));
            target?.focus({ preventScroll: true });
          });
          const toggleOwnedGroup = () => {
            if (!ownedGroupId) return false;
            const toggle = Array.from(tree.querySelectorAll("[aria-controls]")).find((candidate) => (
              candidate.getAttribute("aria-controls") === ownedGroupId
            ));
            if (!toggle) return false;
            const identity = rememberTreeItem();
            toggle.click();
            focusRememberedTreeItem(identity);
            return true;
          };
          if (event.key === "ArrowRight") {
            if (expanded === "false") {
              if (!toggleOwnedGroup()) return;
            } else if (expanded === "true") {
              const child = document.getElementById(ownedGroupId)?.querySelector('[role="treeitem"]');
              if (!child) return;
              child.focus({ preventScroll: true });
            } else {
              return;
            }
          } else if (expanded === "true") {
            if (!toggleOwnedGroup()) return;
          } else {
            const parent = level === 2
              ? treeItem.closest(".project-sidebar-project")?.querySelector('.project-sidebar-item[role="treeitem"]')
              : null;
            if (!parent) return;
            parent.focus({ preventScroll: true });
          }
          return;
        }
        const horizontal = event.currentTarget.id === "workspaceList";
        const selector = event.currentTarget.id === "projectSidebarList"
          ? '[role="treeitem"]'
          : "[data-workspace]";
        const tree = event.currentTarget.id === "projectSidebarList";
        moveFocus(
          event,
          event.currentTarget,
          selector,
          horizontal ? ["ArrowLeft", "ArrowUp"] : ["ArrowUp"],
          horizontal ? ["ArrowRight", "ArrowDown"] : ["ArrowDown"],
          { wrap: !tree, roving: tree },
        );
      });
    });
    $("#projectHistoryRail")?.addEventListener("click", (event) => {
      const inlineTerminal = event.target.closest("[data-pty-focus-trigger]");
      if (inlineTerminal) {
        event.preventDefault();
        event.stopPropagation();
        void openDrawer(inlineTerminal.dataset.ptyFocusTrigger, { trigger: inlineTerminal, focus: true });
        return;
      }
      const open = event.target.closest("[data-open-session]");
      if (open) {
        openDrawer(open.dataset.openSession, {
          context: true,
          ...(open.hasAttribute("data-result-review") ? { tab: "summary", resultReview: true } : {}),
        });
        return;
      }
      if (event.target.closest("#openProjectHistoryBtn")) selectViewFromUser("active", { motionKind: "view" });
    });
    const controlProjectSelect = $("#controlRoomProjectSelect");
    controlProjectSelect?.addEventListener("change", (event) => {
      state.workspace = event.target.value;
      state.workspaceSource = "all";
      state.visibleLimit = 30;
      renderWorkspaces();
      renderSessions("filter");
      preconnectSelectedWorkspace();
      syncFilterResetButton();
      saveDashboardPreferences();
      announce(t("filter.workspace_results", { project: event.target.selectedOptions[0]?.textContent || t("control.all_projects"), count: filteredSessions().length }));
    });
    const memoryProjectSelect = $("#memoryWorkspaceFilter");
    memoryProjectSelect?.addEventListener("change", (event) => {
      state.workspace = event.target.value;
      state.workspaceSource = "all";
      state.visibleLimit = 30;
      renderWorkspaces();
      renderSessions("filter");
      preconnectSelectedWorkspace();
      syncFilterResetButton();
      saveDashboardPreferences();
      announce(t("filter.workspace_results", { project: event.target.selectedOptions[0]?.textContent || t("project.all"), count: filteredSessions().length }));
    });
    const controlSortSelect = $("#controlRoomSortSelect");
    controlSortSelect?.addEventListener("change", (event) => {
      state.controlRoomSort = event.target.value;
      state.visibleLimit = 30;
      renderSessions("filter");
      syncFilterResetButton();
      saveDashboardPreferences();
      announce(t("filter.sort_changed", { sort: event.target.selectedOptions[0]?.textContent || event.target.value, count: filteredSessions().length }));
    });
    const controlSearch = $("#controlRoomSearch");
    const controlSearchInput = $("#controlRoomSearchInput");
    const controlSearchButton = $("#controlRoomSearchBtn");
    let controlSearchTimer = null;
    const setControlSearchOpen = () => {
      controlSearch?.classList.add("is-open");
      controlSearchButton?.setAttribute("aria-expanded", "true");
      if (controlSearchInput) {
        controlSearchInput.tabIndex = 0;
        controlSearchInput.setAttribute("aria-hidden", "false");
      }
      requestAnimationFrame(() => controlSearchInput?.focus());
    };
    controlSearchButton?.addEventListener("click", () => setControlSearchOpen());
    controlSearchInput?.addEventListener("input", (event) => {
      clearTimeout(controlSearchTimer);
      const value = event.target.value;
      if ($("#searchInput")) $("#searchInput").value = value;
      controlSearchTimer = setTimeout(() => {
        state.search = normalizedSearch(value);
        state.visibleLimit = 30;
        renderSessions("filter");
        syncFilterResetButton();
        saveDashboardPreferences();
        announce(t("filter.search_results", { count: filteredSessions().length }));
      }, 120);
    });
    controlSearchInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (event.currentTarget.value) {
        event.currentTarget.value = "";
        event.currentTarget.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const setAllControlRoomGroups = (open) => {
      document.querySelectorAll("#liveSessionGrid .control-room-project-group").forEach(group => {
        group.open = open;
      });
      syncControlRoomDisclosureButtons();
      announce(t(open ? "control.all_projects_expanded" : "control.all_projects_collapsed"));
    };
    $("#controlRoomExpandAll")?.addEventListener("click", () => setAllControlRoomGroups(true));
    $("#controlRoomCollapseAll")?.addEventListener("click", () => setAllControlRoomGroups(false));
    $("#liveSessionGrid")?.addEventListener("toggle", (event) => {
      if (event.target.matches?.(".control-room-project-group")) syncControlRoomDisclosureButtons();
    }, true);
    let searchTimer = null;
    $("#searchInput").addEventListener("input", (event) => {
      clearTimeout(searchTimer);
      const value = event.target.value;
      $("#searchClearBtn").classList.toggle("hidden", !value);
      syncFilterResetButton();
      searchTimer = setTimeout(() => {
        state.search = normalizedSearch(value);
        state.visibleLimit = 30;
        renderSessions("filter");
        announce(window.WhiteboxI18n.t("filter.search_results", { count: filteredSessions().length }));
        syncFilterResetButton();
        saveDashboardPreferences();
      }, 120);
    });
    $("#searchClearBtn").addEventListener("click", () => {
      clearTimeout(searchTimer);
      $("#searchInput").value = "";
      $("#searchClearBtn").classList.add("hidden");
      state.search = "";
      state.visibleLimit = 30;
      renderSessions("filter");
      announce(window.WhiteboxI18n.t("filter.search_cleared"));
      $("#searchInput").focus();
      syncFilterResetButton();
      saveDashboardPreferences();
    });
    $("#searchInput").addEventListener("keydown", (event) => {
      if (event.key === "Escape" && event.currentTarget.value) {
        event.preventDefault();
        $("#searchClearBtn").click();
        return;
      }
      if (event.key === "ArrowDown") {
        const first = $("#sessionGrid [data-session-id]") || $("#liveSessionGrid button, #liveSessionGrid [tabindex='0']");
        if (first) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "Enter" && filteredSessions().length === 1) {
        event.preventDefault();
        const session = filteredSessions()[0];
        openDrawer(session.id, resultReviewTargets(session).length
          ? { tab: "summary", resultReview: true }
          : {});
      }
    });
    $("#providerFilter").addEventListener("click", (event) => {
      const chip = event.target.closest("[data-provider-filter]");
      if (!chip) return;
      toggleProviderFilter(chip.dataset.providerFilter);
      state.visibleLimit = 30;
      renderProviderFilter();
      renderProviderOverview();
      renderSessions("filter");
      announceProviderFilter();
      const next = $("#providerFilter").querySelector(`[data-provider-filter="${CSS.escape(chip.dataset.providerFilter)}"]`);
      next?.classList.add("filter-clicked");
      next?.focus();
      syncFilterResetButton();
      saveDashboardPreferences();
    });
    $("#providerFilter").addEventListener("change", (event) => {
      const select = event.target.closest("#mobileProviderFilterSelect");
      if (!select) return;
      state.providerFilters.clear();
      if (select.value !== "all") state.providerFilters.add(select.value);
      state.visibleLimit = 30;
      renderProviderFilter();
      renderProviderOverview();
      renderSessions("filter");
      announceProviderFilter();
      $("#mobileProviderFilterSelect")?.focus();
      syncFilterResetButton();
      saveDashboardPreferences();
    });
    $("#providerFilter").addEventListener("keydown", (event) => {
      moveFocus(event, event.currentTarget, "[data-provider-filter]", ["ArrowLeft", "ArrowUp"], ["ArrowRight", "ArrowDown"]);
    });
    $("#sortSelect").addEventListener("change", (event) => {
      state.sort = event.target.value;
      state.visibleLimit = 30;
      renderSessions("filter");
      const label = event.target.selectedOptions[0]?.textContent || event.target.value;
      announce(window.WhiteboxI18n.t("filter.sort_changed", { sort: label, count: filteredSessions().length }));
      syncFilterResetButton();
      saveDashboardPreferences();
    });
    $("#resetFiltersBtn").addEventListener("click", () => {
      clearTimeout(searchTimer);
      state.search = "";
      state.providerFilters.clear();
      state.workspace = "all";
      state.workspaceSource = "all";
      state.sort = "recent";
      state.controlRoomSort = "recent";
      state.visibleLimit = 30;
      $("#searchInput").value = "";
      $("#searchClearBtn").classList.add("hidden");
      $("#sortSelect").value = "recent";
      renderWorkspaces();
      renderProviderFilter();
      renderProviderOverview();
      renderSessions("filter");
      preconnectSelectedWorkspace();
      syncFilterResetButton();
      saveDashboardPreferences();
      announce(window.WhiteboxI18n.t("filter.reset_done", { count: filteredSessions().length }));
      $("#searchInput").focus();
    });
    $("#sourcePluginSettingsList")?.addEventListener("change", async (event) => {
      const input = event.target.closest("[data-source-plugin-enabled]");
      if (!input) return;
      const pluginId = input.dataset.sourcePluginEnabled;
      const requestedEnabled = input.checked;
      if (state.sourcePluginSettingRequests?.has(pluginId)) return;
      state.sourcePluginSettingRequests?.add(pluginId);
      input.disabled = true;
      input.closest("[data-source-plugin-option]")?.setAttribute("data-busy", "true");
      let result = null;
      try {
        result = await window.whitebox.setSourcePluginEnabled(pluginId, requestedEnabled);
        if (!result?.settings) throw new Error(t("settings.plugins.save_failed"));
      } catch (error) {
        window.WhiteboxRendererUtils.reportRecoverableError("source-plugin-settings", error);
        state.sourcePluginSettingRequests?.delete(pluginId);
        render("filter");
        toast(t("settings.plugins.save_failed"));
        return;
      }
      state.sourcePluginSettingRequests?.delete(pluginId);
      state.sourcePluginSettings = result.settings;
      if (Array.isArray(result.sources)) state.sourcePlugins = result.sources;
      if (!requestedEnabled && state.workspaceSource === pluginId) {
        state.workspaceSource = "all";
      }
      if (!requestedEnabled && state.runSource === pluginId) {
        state.runSource = "direct";
        state.runDraft = { ...(state.runDraft || {}), sourcePluginId: "direct" };
        syncRunComposer();
        saveRunDraft();
      }
      const selectedAfterChange = (state.rawSnapshot?.sessions || []).find((session) => session.id === state.selectedId)
        || state.details.get(state.selectedId);
      const projectedAfterChange = state.rawSnapshot ? projectVisibleSnapshot(state.rawSnapshot) : null;
      const selectedStillVisible = projectedAfterChange
        ? projectedAfterChange.sessions.some((session) => session.id === state.selectedId)
        : isSourcePluginVisible(selectedAfterChange?.sourcePluginId) && isDesktopSessionVisible(selectedAfterChange);
      if (!requestedEnabled && selectedAfterChange && !selectedStillVisible) closeDrawer();
      if (projectedAfterChange) state.snapshot = projectedAfterChange;
      if (window.WhiteboxTerminal) window.WhiteboxTerminal.updateSnapshot(visibleSnapshot(), state.workspaces);
      render("filter");
      const source = (state.sourcePlugins || []).find((item) => item.id === pluginId);
      const fallbackLabels = {
        "builtin.opencode": "OpenCode",
        "builtin.aside": "Aside",
        "builtin.claude-desktop": "Claude Desktop",
        "builtin.codex-desktop": "Codex Desktop",
      };
      const label = source?.source?.label || fallbackLabels[pluginId] || pluginId;
      const activationWarning = String(result.warning || "").trim();
      const toastKey = activationWarning
        ? "settings.plugins.activation_warning"
        : requestedEnabled ? "settings.plugins.enabled_toast" : "settings.plugins.disabled_toast";
      toast(t(toastKey, { plugin: label, detail: activationWarning }));
      saveDashboardPreferences();
    });
    $("#providerVisibilityList").addEventListener("change", async (event) => {
      const input = event.target.closest("[data-provider-visibility]");
      if (!input) return;
      const providerId = input.dataset.providerVisibility;
      const previousVisible = !input.checked;
      const selectedBeforeChange = (state.rawSnapshot?.sessions || []).find((session) => session.id === state.selectedId)
        || state.details.get(state.selectedId);
      setProviderVisible(providerId, input.checked);
      state.visibleLimit = 30;
      if (state.selectedId && selectedBeforeChange && !selectedBeforeChange.sourcePluginId && state.hiddenProviders.has(selectedBeforeChange.provider)) closeDrawer();
      if (window.WhiteboxTerminal) window.WhiteboxTerminal.updateSnapshot(visibleSnapshot(), state.workspaces);
      render("filter");
      try {
        await Promise.resolve(window.whitebox.setProviderVisibility?.({ hidden: [...state.hiddenProviders] }));
      } catch (error) {
        window.WhiteboxRendererUtils.reportRecoverableError("provider-visibility-persistence", error);
        setProviderVisible(providerId, previousVisible);
        if (window.WhiteboxTerminal) window.WhiteboxTerminal.updateSnapshot(visibleSnapshot(), state.workspaces);
        render("filter");
        toast(t("settings.providers.save_failed"));
        return;
      }
      const provider = state.providers.find((item) => item.id === providerId);
      toast(t(input.checked ? "settings.providers.shown_toast" : "settings.providers.hidden_toast", {
        provider: provider?.label || "선택한 AI",
      }));
    });
    const addWorkspaceButtons = [$("#sidebarNewProjectBtn"), $("#addWorkspaceBtn")].filter(Boolean);
    const addWorkspace = async (event) => {
      const trigger = event.currentTarget;
      const response = await performUiAction(() => window.whitebox.addWorkspaces(), t("workspace.add_failed"), trigger);
      if (!response || response.canceled) return;
      const workspaces = Array.isArray(response) ? response : response.workspaces;
      if (!Array.isArray(workspaces)) return;
      const previousPaths = new Set(state.workspaces.map((workspace) => workspace.path));
      state.workspaces = workspaces;
      const added = state.workspaces.find((workspace) => !previousPaths.has(workspace.path));
      const selected = Array.isArray(response) ? added : response.selected;
      if (!selected?.path) {
        renderWorkspaces();
        syncFilterResetButton();
        return;
      }
      const selectedKey = normalizedProjectPath(selected.path);
      state.dismissedProjects = new Set([...state.dismissedProjects].filter((dismissedPath) => (
        dismissedPath !== selectedKey
        && !selectedKey.startsWith(`${dismissedPath}/`)
        && !dismissedPath.startsWith(`${selectedKey}/`)
      )));
      saveProjectDismissals();
      state.sidebarProjectSearch = "";
      if ($("#sidebarProjectSearch")) $("#sidebarProjectSearch").value = "";
      state.workspace = selected.path;
      state.workspaceSource = "all";
      state.visibleLimit = 30;
      if (state.view !== "all") selectViewFromUser("all", { motionKind: "filter" });
      else render();
      preconnectSelectedWorkspace();
      syncFilterResetButton();
      saveDashboardPreferences();
      toast(t(response.alreadyAdded ? "control.project_already_ready" : "control.project_added_ready"));
      announce(t(response.alreadyAdded ? "control.project_already_ready" : "control.project_added_ready"));
      requestAnimationFrame(() => {
        const targetList = trigger.id === "sidebarNewProjectBtn"
            ? $("#projectSidebarList")
            : $("#workspaceList");
        targetList?.querySelector(`[data-workspace="${CSS.escape(selected.path)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    };
    addWorkspaceButtons.forEach((button) => button.addEventListener("click", addWorkspace));
    $("#probeBtn").addEventListener("click", async () => {
      const nextAvailability = await performUiAction(() => window.whitebox.probeProviders(), t("run.cli_check_failed"), $("#probeBtn"));
      if (!nextAvailability) return;
      state.availability = nextAvailability;
      context.syncRunProviderAvailability();
      render();
      toast(window.WhiteboxI18n.t("ui.ai_cli_connections_were_checked_again"));
    });
    $("#searchClearBtn").classList.toggle("hidden", !$("#searchInput").value);
    syncFilterResetButton();
  }

  return { bindFilterAndWorkspaceEvents };
};
