'use strict';

(() => {
  // Only static application copy passes through these helpers. Interpolated
  // terminal output, paths, user labels and AI text are never translated here.
  const messages = [
  ['답변 완료', 'Answer complete', '回答完成'],
  ['API 키를 저장하면 판단 분석에 Jev를 자동으로 사용합니다. 요청과 연결된 작업 기록을 TypeSafe에 전송해 근거 충족 여부·검증 범위 변화·복구·중복 확인을 판단합니다.', 'Saving an API key automatically selects Jev for judgment analysis. Linked task records are sent to TypeSafe to assess support, coverage changes, recovery and repeated checks.', '保存 API 密钥后，自动使用 Jev 进行判断分析。相关任务记录会发送给 TypeSafe，以判断证据、验证范围变化、恢复和重复检查。'],
  ['현재 분석 서비스: ', 'Current analysis service: ', '当前分析服务：'],
  ['. Jev를 사용하려면 분석 설정에서 선택하세요.', '. Select Jev in analysis settings to use it.', '。如需使用 Jev，请在分析设置中选择。'],
  ['Jev를 분석 서비스로 사용합니다.', 'Jev is selected as the analysis service.', '已选择 Jev 作为分析服务。'],
  ['분석 설정', 'Analysis settings', '分析设置'],
  ['보기', 'Show', '显示'],
  ['저장된 API 키를 확인할 수 없습니다. 다시 저장해 주세요.', 'Could not read the saved API key. Please save it again.', '无法读取已保存的 API 密钥，请重新保存。'],
  ['API 키 저장됨', 'API key saved', 'API 密钥已保存'],
  ['저장된 키 사용 중 · 변경할 때만 입력', 'Saved key in use · enter only to replace', '正在使用已保存的密钥 · 仅更换时输入'],
  ['API 키가 저장되어 있습니다. 변경할 때만 새 키를 입력하세요.', 'Your API key is saved. Enter a new key only to replace it.', 'API 密钥已保存。仅在更换时输入新密钥。'],
  ['API 키 저장을 확인하지 못했습니다. 다시 시도해 주세요.', 'Could not confirm the API key was saved. Please retry.', '无法确认 API 密钥已保存，请重试。'],
  ['저장 중…', 'Saving…', '正在保存…'],
  ['설정 항목', 'Settings categories', '设置分类'],
  ['설정이 적용되었습니다.', 'Settings applied.', '设置已应用。'],
  ['설정', 'Settings', '设置'],
  ['일반', 'General', '常规'],
  ['연결', 'Connections', '连接'],
  ['단축키', 'Shortcuts', '快捷键'],
  ['모양', 'Appearance', '外观'],
  ['라이트', 'Light', '浅色'],
  ['다크', 'Dark', '深色'],
  ['시스템', 'System', '系统'],
  ['언어', 'Language', '语言'],
  ['완료', 'Done', '完成'],
  ['화면과 언어, 알림을 설정합니다.', 'Set appearance, language and notifications.', '设置外观、语言和通知。'],
  ['앱 전체에 적용할 테마', 'Theme used across the app', '应用整体主题'],
  ['메뉴와 설정 화면의 표시 언어', 'Language for menus and settings', '菜单和设置的显示语言'],
  ['입력 요청 알림', 'Input request notifications', '输入请求通知'],
  ['앱 업데이트', 'App updates', '应用更新'],
  ['편하게 읽고 입력할 수 있도록 조정합니다.', 'Adjust your terminal for comfortable reading and typing.', '调整终端，舒适地阅读和输入。'],
  ['글꼴', 'Font', '字体'],
  ['터미널에서 사용할 고정폭 글꼴', 'Monospaced font for terminals', '终端使用的等宽字体'],
  ['글자 크기', 'Font size', '字号'],
  ['모든 터미널에 적용', 'Apply to every terminal', '应用到所有终端'],
  ['글자 작게', 'Decrease font size', '减小字号'],
  ['글자 크게', 'Increase font size', '增大字号'],
  ['미리보기', 'Preview', '预览'],
  ['분석 방식과 사용할 AI를 선택합니다.', 'Choose how to analyze and which AI to use.', '选择分析方式和使用的 AI。'],
  ['새로운 작업 결과를 자동으로 분석', 'Automatically analyze new work results', '自动分析新的工作结果'],
  ['이해 · 검토에 사용할 AI', 'AI used for understanding and review', '用于理解和审查的 AI'],
  ['분석과 사용량 안내', 'Analysis and usage information', '分析和用量说明'],
  ['AI 연결과 API 키를 관리합니다.', 'Manage AI connections and API keys.', '管理 AI 连接和 API 密钥。'],
  ['이 컴퓨터에 설치된 CLI 사용', 'Uses the CLI installed on this computer', '使用此计算机安装的 CLI'],
  ['API 키 표시 전환', 'Show or hide API key', '显示或隐藏 API 密钥'],
  ['표시', 'Show', '显示'],
  ['숨기기', 'Hide', '隐藏'],
  ['자주 사용하는 동작을 빠르게 실행합니다.', 'Quickly run frequently used actions.', '快速执行常用操作。'],
  ['히스토리', 'History', '历史'],
  ['선택한 터미널', 'Selected terminal', '所选终端'],
  ['터미널 연결 중…', 'Connecting terminal…', '正在连接终端…'],
  ['내 작업 공간', 'My workspace', '我的工作区'],
  ['프로젝트 찾기', 'Find a project', '查找项目'],
  ['작업 공간', 'Workspace', '工作区'],
  ['로컬 작업 공간', 'Local workspace', '本地工作区'],
  ['만드는 일에, 집중하세요', 'Focus on what you build', '专注于创造'],
  ['터미널에서 실행하고, 옆에서 이해하고 검토합니다.', 'Run in your terminal. Understand and review alongside.', '在终端运行，在旁理解与审查。'],
  ['새 터미널', 'New terminal', '新建终端'],
  ['사이드바 접기', 'Toggle sidebar', '切换侧边栏'],
  ['터미널 배치', 'Terminal layout', '终端布局'],
  ['좌우 분할', 'Split horizontally', '左右分屏'],
  ['상하 분할', 'Split vertically', '上下分屏'],
  ['패널 분리 · 화면 배치', 'Separate panel · Arrange view', '分离面板 · 屏幕布局'],
  ['패널을 분리해도 같은 화면에서 함께 봅니다. 다른 패널은 테두리 색으로 구분합니다.', 'Separate panels stay together on screen. Border colors distinguish different panels.', '分离后的面板仍在同一屏幕显示，以边框颜色区分。'],
  ['함께 볼 패널', 'Panel to display alongside', '同屏显示的面板'],
  ['패널 분리', 'Separate panel', '分离面板'],
  ['같은 패널로 묶기', 'Join the same panel', '合并到同一面板'],
  ['분할 배치', 'Arrange split view', '分屏布局'],
  ['분리된 패널', 'Separate panel', '独立面板'],
  ["이 패널 함께 보기", "Show this panel alongside", "同时显示此面板"],
  ["함께 보기 해제", "Unpin panel", "取消固定面板"],
  ["Jev · 판단 분석", "Jev · Typed analysis", "Jev · 结构化分析"],
  ["Jev 플러그인", "Jev plugin", "Jev 插件"],
  ["API 키를 저장한 뒤 분석 서비스에서 Jev를 선택하세요. 요청과 연결된 작업 기록을 TypeSafe에 전송해 근거 충족 여부·검증 범위 변화·복구·중복 확인을 판단합니다.", "Save an API key, then select Jev as the analysis service. Linked task records are sent to TypeSafe to assess support, coverage changes, recovery and repeated checks.", "保存 API 密钥后，在分析服务中选择 Jev。相关任务记录会发送给 TypeSafe，以判断证据、验证范围变化、恢复和重复检查。"],
  ["API 키", "API key", "API 密钥"],
  ["키 저장", "Save key", "保存密钥"],
  ["연결 해제", "Disconnect", "断开连接"],
  ["Jev 연결됨", "Jev connected", "Jev 已连接"],
  ["Jev 연결 해제됨", "Jev disconnected", "Jev 已断开"],
  ["API 키를 저장해 연결하세요.", "Save an API key to connect.", "保存 API 密钥以连接。"],
  ["근거 준비 중…", "Preparing evidence…", "正在准备证据…"],
  ["판단 요약", "Decision summary", "判断摘要"],
  ["프로젝트", "Projects", "项目"],
  ["패널", "Panel", "面板"],
  ["셸", "Shell", "Shell"],
  ["패널 추가", "Add panel", "添加面板"],
  ["독립 패널 추가", "Add independent panel", "添加独立面板"],
  ["작업 폴더별로 묶은 패널", "Panels grouped by project folder", "按项目文件夹分组的面板"],
  ["프로젝트에 속하지 않는 패널", "Panels outside projects", "不属于项目的面板"],
  ["프로젝트 펼치기·접기", "Expand or collapse project", "展开或收起项目"],
  ["패널 펼치기·접기", "Expand or collapse panel", "展开或收起面板"],
  ["생성 중…", "Creating…", "正在创建…"],
  ["패널 생성 중…", "Creating panel…", "正在创建面板…"],
  ["터미널을 연결하고 있어요.", "Connecting the terminal.", "正在连接终端。"],
  ["시작 중…", "Starting…", "正在启动…"],
  ["종료 중…", "Stopping…", "正在停止…"],
  ["실행 실패", "Failed", "启动失败"],
  ["작업 중", "Working", "工作中"],
  ["입력 대기", "Waiting for input", "等待输入"],
  ["사용자 응답 대기", "Waiting for your response", "等待您的回复"],
  ["작업 상태 확인 중", "Checking activity", "正在确认工作状态"],
  ["터미널 연결에 실패했습니다.", "Could not connect to the terminal.", "无法连接终端。"],
  ["다시 연결", "Reconnect", "重新连接"],
  ["선택한 패널", "Selected panel", "所选面板"],
  ["이 패널의 터미널", "Terminals in this panel", "此面板中的终端"],
  ["자동 분석", "Auto analysis", "自动分析"],
  ["자동 분석 켜짐", "Automatic analysis on", "自动分析已开启"],
  ["자동 분석 꺼짐", "Automatic analysis off", "自动分析已关闭"],
  ["분석 기록", "Analysis history", "分析记录"],
  ["이해와 검토 내용", "Understanding and review", "理解与审查内容"],
  ["다시 분석", "Analyze again", "重新分析"],
  ["요청한 일", "Your request", "您的请求"],
  ["실제로 한 일", "Reported work", "实际完成的工作"],
  ["현재 결론", "Current conclusion", "当前结论"],
  ["판단 이유", "Reasons for this judgment", "判断依据"],
  ["판단 전에 알아둘 점", "What could affect this decision", "判断前需要了解的事项"],
  ["권하는 다음 행동", "Recommended next action", "建议的下一步"],
  ["여기서 마쳐도 돼요", "You can finish here", "可以到此结束"],
  ["선택지 비교", "Compare alternatives", "比较选项"],
  ["이 선택이 나은 조건", "When this option is preferable", "此选项更合适的条件"],
  ["다음 결정을 위한 요약", "Summary for your next decision", "辅助下一步决策的摘要"],
  ["판단의 근거 기록", "Evidence behind the judgment", "判断的依据记录"],
  ["판단 요약을 확인하지 못해 작업 기록을 표시합니다.", "The decision summary could not be validated. Showing the work record.", "无法验证决策摘要，显示工作记录。"],
  ["왜 이렇게 바꿨나요?", "Why was it changed?", "为什么这样修改？"],
  ["아직 분석할 작업이 없어요.", "No work to analyze yet.", "还没有可分析的工作。"],
  ["이 터미널에서 AI와 작업하면 요청과 결과를 분석해 이곳에 표시합니다.", "Work with AI in this terminal to see an analysis of your request and its result here.", "在此终端中与 AI 工作后，将在这里显示请求与结果的分析。"],
  ["아직 이전 분석 기록이 없어요.", "No earlier analysis yet.", "还没有以前的分析记录。"],
  ["업데이트", "Updates", "更新"],
  ["업데이트 있음", "Update available", "有可用更新"],
  ["새 버전 ", "New version ", "新版本 "],
  ["실행 중 ", "Running ", "运行版本 "],
  [" · 최신 ", " · Latest ", " · 最新版本 "],
  ["업데이트 대상 설치 버전: ", "Installed version to update: ", "待更新的安装版本："],
  ["확인 전", "Not checked", "尚未检查"],
  ["확인 불가", "Unavailable", "无法确认"],
  ["업데이트 확인 전", "Updates not checked", "尚未检查更新"],
  ["업데이트 확인 중…", "Checking for updates…", "正在检查更新…"],
  ["최신 버전입니다.", "You are up to date.", "已是最新版本。"],
  ["업데이트 다운로드 중…", "Downloading update…", "正在下载更新…"],
  ["업데이트 설치 준비 완료", "Update ready to install", "更新已准备好安装"],
  ["업데이트 설치 중…", "Installing update…", "正在安装更新…"],
  ["업데이트를 확인하지 못했습니다.", "Could not check for updates.", "无法检查更新。"],
  ["수동 업데이트가 필요합니다.", "A manual update is required.", "需要手动更新。"],
  ["앱 시작 시와 15분마다 새 버전을 자동으로 확인합니다.", "Checks for new versions at startup and every 15 minutes.", "启动时及每15分钟自动检查新版本。"],
  ["마지막 확인: ", "Last checked: ", "上次检查："],
  ["업데이트 확인", "Check for updates", "检查更新"],
  ["업데이트 설치", "Install update", "安装更新"],
  ["설치 파일 열기", "Open installer", "打开安装程序"],
  ["설치 파일 받기", "Download installer", "下载安装程序"],
  ["버전 안내 보기", "View release details", "查看版本说明"],
  ["이번 버전의 변경 사항", "What's new in this version", "此版本的更改"],
  ["업데이트 다운로드", "Update download", "下载更新"],
  ["작업 중에도 의미 있는 결과가 수집되면 분석합니다. 근거가 부족하면 기다리고, 같은 결과는 다시 분석하지 않습니다. 결과가 나오기 전에는 분석중 상태만 표시합니다. 고정 사용량 상한은 없으며 자동 이해·검토를 끄면 추가 호출을 멈춥니다.", "Meaningful results can be analyzed during work. Analysis waits for sufficient evidence and does not repeat unchanged results. Only the analysis status is shown until results are available. There is no fixed cumulative usage cap; turn automatic review off to stop further calls.", "工作中收集到有意义的结果时也会分析。证据不足时等待，不重复分析相同结果。结果出来前仅显示分析状态。不设累计用量上限；关闭自动审查可停止后续调用。"],
  ["작업 관찰 중", "Observing work", "正在观察工作"],
  ["분석 사용 한도 대기", "Waiting for analysis capacity", "等待分析额度恢复"],
  ["다시 시도까지", "Retry in", "重试倒计时"],
  ["분석 대기", "Waiting for analysis", "等待分析"],
  ["분석이 평소보다 오래 걸리고 있어요. 완료되면 표시할게요.", "Analysis is taking longer than usual. Results will appear when ready.", "分析时间较长，完成后将显示结果。"],
  ["중단 시점까지 확인된 내용", "Observed before interruption", "中断前已记录的内容"],
  ["현재까지 확인된 내용", "Observed so far", "目前已记录的内容"],
  ["구체적인 작업 결과를 기다리고 있어요.", "Waiting for concrete work results.", "等待具体工作结果。"],
  ["일부 요구사항이 남아 있어요", "Some requirements remain", "部分要求尚未完成"],
  ["현재까지의 작업을 설명합니다", "Explaining work so far", "说明目前的工作"],
  ["중단됨 · 수행 기록", "Interrupted · execution record", "已中断 · 执行记录"],
  ["작업 진행 중 · 현재까지 분석", "Work in progress · interim analysis", "工作进行中 · 阶段分析"],
  ["근거 수집 대기", "Waiting for evidence", "等待证据"],
  ["근거가 확보되면 분석합니다", "Analysis starts when evidence arrives", "收到证据后开始分析"],
  ["확인된 근거", "Recorded evidence", "已记录的证据"],
  ["완료 판단에 필요한 확인", "Checks needed to judge completion", "判断完成所需的确认"],
  ["왜 바꿨나요?", "Why was it changed?", "为什么修改？"],
  ["어떻게 동작하나요?", "How does it work?", "如何工作？"],
  ["요청과 분석 기록", "Request and analysis history", "请求与分析记录"],
  ["이전 요청의 요구사항이 변경됐어요. 이후 결과는 새 요청을 기준으로 분석합니다.", "Requirements changed. Subsequent results are assessed against the new request.", "要求已更改，后续结果将按新请求分析。"],
  ["휴지통 전체 삭제", "Empty trash", "清空回收站"],
  ["휴지통을 비울까요?", "Empty the trash?", "清空回收站？"],
  ["전체 영구 삭제", "Permanently delete all", "永久删除全部"],
  ["터미널 세션이 바뀌어 삭제하지 않았습니다.", "The terminal session changed, so it was not deleted.", "终端会话已更改，未执行删除。"],
  ["휴지통의 인스턴스 ", "Permanently delete all ", "永久删除回收站中的全部 "],
  ["개를 모두 영구 삭제합니다. 실행 중인 프로그램도 종료되며 복구할 수 없습니다.", " instances in the trash. Running programs will stop. This cannot be undone.", " 个会话。运行中的程序也将终止，且无法恢复。"],
  ["삭제 중 ", "Deleting ", "正在删除 "],
  ["개 삭제했습니다. ", " deleted. ", " 个已删除。"],
  ["개는 삭제하지 못해 휴지통에 남겨두었습니다.", " could not be deleted and remain in the trash.", " 个删除失败，仍保留在回收站中。"],
  ["개를 영구 삭제했습니다.", " permanently deleted.", " 个已永久删除。"],
  ["터미널 추가", "Add terminal", "添加终端"],
  ["이 패널에 터미널 추가", "Add terminal to this panel", "在此面板添加终端"],
  ["독립 패널 만들기", "Create independent panel", "创建独立面板"],
  ["같은 패널의 터미널은 자동으로 연결됩니다.", "Terminals in the same panel are connected automatically.", "同一面板的终端自动连接。"],
  ["whitebox list-panels · whitebox send · whitebox read-screen으로 현재 패널을 제어할 수 있습니다.", "Control this panel with whitebox list-panels, whitebox send, and whitebox read-screen.", "使用 whitebox list-panels、whitebox send 和 whitebox read-screen 控制当前面板。"],
  ["터미널을 다른 패널로 옮기면 연결 목록도 함께 바뀝니다.", "Moving a terminal to another panel updates its connections.", "将终端移动到另一面板时，连接列表随之更新。"],
  ["권한·질문 팝업", "Permission and question popups", "权限与问题弹窗"],
  ["오른쪽 아래 응답 창", "Bottom-right response window", "右下角响应窗口"],
  ["AI가 권한이나 답변을 요청하면 다른 창 위에서도 바로 확인하고 응답할 수 있는 작은 창을 표시합니다.", "Show a small window above other apps when AI needs permission or an answer.", "当 AI 请求权限或回答时，在其他窗口上方显示可直接响应的小窗口。"],
  ["같은 패널의 터미널끼리 작업 요청과 응답을 연결합니다.", "Connect requests and replies between terminals in this panel.", "连接同一面板内终端的请求和回复。"],
  ["협업 연결됨", "Collaboration connected", "协作已连接"],
  ["자동 연결 대기", "Waiting to connect", "等待自动连接"],
  ["AI 실행 대기", "Waiting for AI", "等待 AI 启动"],
  ["독립 패널", "Independent panels", "独立面板"],
  ["터미널을 끌어 패널에 넣거나 새 패널로 꺼내세요. 숨겨진 터미널도 계속 실행됩니다.", "Drag terminals into panels or out into a new panel. Hidden terminals keep running.", "拖动终端以加入面板或移出到新面板。隐藏的终端仍会继续运行。"],
  ["실행 중인 작업과 터미널 기록은 그대로 유지됩니다.", "Running tasks and terminal history are preserved.", "运行中的任务和终端记录保持不变。"],
  ["현재 패널에 터미널 추가", "Add terminal to current panel", "在当前面板添加终端"],
  ["터미널 패널", "Terminal panels", "终端面板"],
  ["터미널 이동", "Move terminal", "移动终端"],
  ["대상 패널", "Destination panel", "目标面板"],
  ["새 패널로 분리", "Detach into new panel", "移至新面板"],
  ["새 패널", "New panel", "新建面板"],
  ["패널 ", "Panel ", "面板 "],
  ["백그라운드 실행", "Running in background", "后台运行"],
  ["보고 있음", "Visible", "正在查看"],
  ["여기로 끌어 분리", "Drop here to detach", "拖到此处移出"],
  ["왼쪽에 배치", "Place on the left", "放在左侧"],
  ["오른쪽에 배치", "Place on the right", "放在右侧"],
  ["위에 배치", "Place above", "放在上方"],
  ["아래에 배치", "Place below", "放在下方"],
  ["오른쪽", "Right", "右侧"],
  ["왼쪽", "Left", "左侧"],
  ["배치", "Position", "位置"],
  ["답변은 요청 취지에 맞아요", "The response addresses your request", "回答符合请求意图"],
  ["요청 충족 여부", "Request fulfillment", "请求满足情况"],
  ["실행 기록", "Execution records", "执行记录"],
  ["내용 정확성", "Content accuracy", "内容准确性"],
  ["기록에서 확인한 범위", "What the records support", "记录支持的范围"],
  ["결과 수신", "Result received", "已收到结果"],
  ["오류 보고", "Error reported", "已报告错误"],
  ["호출 기록", "Call recorded", "已记录调用"],
  ["이 분석에 제공된 도구 기록이 없어요. 미실행을 뜻하지는 않아요.", "No tool records were supplied to this review. This does not mean no tools ran.", "本次审查未提供工具记录，并不表示未执行工具。"],
  ["결과 수신은 작업 성공이나 내용의 정확성을 보장하지 않아요.", "Receiving a result does not guarantee success or factual accuracy.", "收到结果不保证任务成功或内容准确。"],
  ["일부 실행 기록은 길이 제한으로 생략됐어요.", "Some execution records were omitted due to the length limit.", "部分执行记录因长度限制被省略。"],
  ["제공된 기록만 비교했어요. 원문이나 실제 동작을 별도로 검증하지 않았어요.", "Only the supplied records were compared. Original sources and actual behavior were not independently verified.", "仅比较了所提供的记录，未独立验证原文或实际行为。"],
  ["외부 원문 대조·독립 실행 검증은 하지 않았어요.", "No independent source check or execution test was performed.", "未进行独立原文核对或执行测试。"],
  ["0 토큰 · 호출 없음", "0 tokens · no call", "0 令牌 · 未调用"],
  ["AI 분석 없이 기록", "Recorded without AI analysis", "仅记录，未进行 AI 分析"],
  ["상세 분석", "Detailed analysis", "详细分析"],
  ["추가 토큰 사용", "Uses additional tokens", "使用额外令牌"],
  ["추가 토큰을 사용해 이 요청을 자세히 분석합니다.", "Analyze this request in detail using additional tokens.", "使用额外令牌详细分析此请求。"],
  ["인사·감사는 AI 호출 없이 기록합니다. 작업은 짧게 검토하고, 상세 분석은 요청할 때만 실행합니다.", "Greetings and thanks are recorded without an AI call. Tasks get a brief review; detailed analysis runs only on request.", "问候和感谢仅记录，不调用 AI。任务进行简短审查，详细分析仅在请求时运行。"],
  ["요청·답변과 수집된 변경 기록을 비교합니다. 실제 동작을 보장하는 테스트는 아닙니다.", "Compares requests, responses and collected change records. This is not a test that guarantees actual behavior.", "比较请求、回答和收集到的变更记录。这不是确保实际行为的测试。"],
  ["AI 답변 중", "AI is responding", "AI 正在回答"],
  ["협업 기록", "Collaboration history", "协作记录"],
  ["아직 협업 기록이 없습니다.", "No collaboration history yet.", "暂无协作记录。"],
  ["새 터미널 열림", "New terminal opened", "已打开新终端"],
  ["터미널 협업", "Terminal collaboration", "终端协作"],
  ["같은 작업 공간의 터미널끼리 작업 요청과 응답을 연결합니다.", "Send tasks and collect replies between terminals in this workspace.", "连接同一工作区内终端的任务请求和回复。"],
  ["이 터미널의 AI가 같은 작업 공간의 다른 터미널에 요청하고 답변을 받아올 수 있게 연결합니다.", "Connect this AI to request work from other terminals in the same workspace and collect their replies.", "连接此 AI，以向同一工作区中的其他终端请求任务并获取回复。"],
  ["Claude 또는 Codex를 실행한 뒤 입력창을 비워 주세요. 아래 버튼은 현재 AI에게 협업 방법을 한 번 전달합니다.", "Run Claude or Codex and clear the input. The button below sends collaboration instructions to the current AI.", "运行 Claude 或 Codex 并清空输入框。下方按钮将协作说明发送给当前 AI。"],
  ["이 터미널 연결", "Connect this terminal", "连接此终端"],
  ["이 터미널은 연결되어 있습니다.", "This terminal is connected.", "此终端已连接。"],
  ["협업 연결 확인 필요", "Check collaboration connection", "请检查协作连接"],
  ["전달 대기", "Queued", "等待发送"],
  ["전달 중", "Sending", "正在发送"],
  ["상대 답변 대기", "Waiting for peer reply", "等待对方回复"],
  ["응답 도착", "Reply received", "已收到回复"],
  ["전달 실패", "Delivery failed", "发送失败"],
  ["확인 필요", "Needs attention", "需要检查"],

  ["이 요청의 분석 기록", "Analyses of this request", "此请求的分析记录"],
  ["분석 ", "Analysis ", "分析 "],
  ["내가 보낸 요청", "Your submitted request", "您提交的请求"],
  ["AI 설명은 요청과 맞아요", "The AI’s report matches your request", "AI 的说明符合您的请求"],
  ["이번 요청 검토 완료", "Review of this request complete", "本次请求审查完成"],
  ["이번 요청", "This request", "本次请求"],
  ["이전 요청", "Previous request", "上次请求"],
  ["무엇이 달라졌나요?", "What changed?", "有什么变化？"],
  ["어디까지 확인됐나요?", "What has been checked?", "确认了哪些内容？"],
  ["아직 확인할 것", "Still to check", "仍需确认"],
  ["자세히 이해하기", "Understand the details", "了解详情"],
  ["어떻게 동작하나요?", "How does it work?", "如何运作？"],
  ["다른 곳에도 영향이 있나요?", "Does it affect anything else?", "是否影响其他部分？"],
  ["실제 동작은 아직 확인하지 못했어요.", "The actual behavior has not been checked yet.", "尚未确认实际运行情况。"],
  ["이 기록만으로 다른 곳의 영향까지 확인할 수 없어요.", "These records do not establish the impact elsewhere.", "仅凭这些记录无法确认其他部分的影响。"],
  ["AI의 답변 기록을 바탕으로 설명합니다. Whitebox가 코드나 실제 동작을 직접 검사한 결과는 아닙니다.", "This explanation is based on the AI response. Whitebox has not directly inspected the code or tested its behavior.", "此说明基于 AI 的回答记录。Whitebox 未直接检查代码或测试实际行为。"],
  ["요청 한 번이 작업 하나예요. 작은 문구 수정도 따로 남습니다.", "One submitted request is one task, even a small text edit.", "一次提交的请求就是一个任务，小的文字修改也会单独记录。"],
  ["확인할 내용으로 다음 요청 준비", "Prepare a follow-up request", "准备后续确认请求"],
  ["다음 요청 준비", "Prepare next request", "准备下一条请求"],
  ["내용을 확인하고 복사해 터미널에 붙여 넣으세요. 자동으로 전송하지 않습니다.", "Review and copy this text, then paste it into your terminal. It will not be sent automatically.", "检查并复制内容后粘贴到终端，不会自动发送。"],
  ["요청 내용", "Request text", "请求内容"],
  ["요청 복사", "Copy request", "复制请求"],
  ["닫기", "Close", "关闭"],
  ["복사했어요. 원하는 터미널에 붙여 넣고 보내세요.", "Copied. Paste it into the terminal you want and send it.", "已复制，请粘贴到所需终端并发送。"],
  ["복사하지 못했어요. 내용을 선택해 직접 복사해 주세요.", "Could not copy. Select the text and copy it manually.", "复制失败，请选择文本并手动复制。"],
  ["터미널 작업 토큰을 제외한 Whitebox 이해·검토 생성 토큰입니다.", "Tokens used to generate Whitebox's review only, excluding terminal task usage.", "仅包含生成 Whitebox 理解与审查所用的令牌，不包括终端任务用量。"],
  ["토큰", "tokens", "令牌"],
  ["토큰 미제공", "Tokens unavailable", "令牌数据缺失"],
  ["입력", "Input", "输入"],
  ["출력", "Output", "输出"],
  ["캐시 읽기", "Cache read", "缓存读取"],
  ["캐시 쓰기", "Cache write", "缓存写入"],
  ["이 분석 호출의 전체 사용량입니다. 여러 요청을 함께 분석한 경우 같은 사용량이 표시됩니다.", "Total usage for this analysis call. Requests analyzed together show the same usage.", "本次分析调用的总用量。同时分析的多个请求显示相同用量。"],
  ["이 분석의 토큰 사용량이 기록되지 않았습니다.", "Token usage was not recorded for this analysis.", "此次分析未记录令牌用量。"],
  ["주간 한도", "Weekly limit", "每周额度"],
  ["5시간 한도", "5-hour limit", "5 小时额度"],
  ["단기 한도", "Short-term limit", "短期额度"],
  ["장기 한도", "Long-term limit", "长期额度"],
  ["<div class=\"wb-review-empty wb-review-complete\"><h2>검토를 마쳤습니다.</h2><p>현재 대화에서 비교할 작업 요청을 찾지 못했습니다. 새 작업을 요청하면 답변이 끝난 뒤 이곳에 검토 결과를 표시합니다.</p></div>", "<div class=\"wb-review-empty wb-review-complete\"><h2>Review complete.</h2><p>No task request to compare was found in this conversation. Send a new task and its review will appear here after the answer finishes.</p></div>", "<div class=\"wb-review-empty wb-review-complete\"><h2>审查已完成。</h2><p>当前对话中未找到可比较的任务请求。发送新任务，回答结束后将在此显示审查结果。</p></div>"],
  [" 계정 전체 · ", " account total · ", " 账户累计 · "],
  ["이번 분석의 소모율이 아닌 계정 누적 사용률입니다.", "Cumulative account usage, not the cost of this analysis.", "这是账户累计使用率，而非本次分析的消耗。"],
  ["답변 완료 다시 확인", "Check answer completion again", "再次检查回答是否完成"],
  ["같은 AI 세션의 실제 완료 기록을 확인하고 있습니다.", "Checking completion events from this AI session.", "正在检查此 AI 会话的实际完成记录。"],
  ["터미널의 답변 완료 표시를 확인하고 있습니다.", "Checking the terminal for an answer completion signal.", "正在检查终端中的回答完成信号。"],
  ["보관된 이해·검토 결과입니다. 새 분석은 다음 답변이 끝난 뒤 시작됩니다.", "Saved review results. A new analysis starts after the next answer is complete.", "这是保存的理解与审查结果。下一次回答完成后才会开始新分析。"],
  ["원래 실행 세션에 연결할 수 없습니다. 새 셸로 대체하지 않습니다.", "The original live session is unavailable. It will not be replaced by a new shell.", "无法连接原来的运行会话，不会用新 shell 替代。"],
  ["세션 연결 불가", "Session unavailable", "无法连接会话"],
  [" 세션 복구", " · Restore session", " · 恢复会话"],
  ["일반 셸", "Shell", "普通 shell"],
  ["AI 답변 완료를 기다리는 중", "Waiting for the AI to finish", "等待 AI 完成回答"],
  ["새 요청을 기다리는 중", "Waiting for a new request", "等待新请求"],
  ["답변 완료 · 분석 대기", "Answer complete · analysis queued", "回答完成 · 等待分析"],
  ["터미널에서 새 요청을 보내고 AI의 답변 완료 표시를 확인했을 때 이해·검토를 시작합니다. 답변 중이거나 승인을 기다릴 때는 분석하지 않습니다. 완료 표시를 확인할 수 없으면 대기합니다. 기존 대화는 다시 검토 버튼으로 확인할 수 있습니다. 선택한 모델의 계정 사용량이 발생하며, 터미널별로 따로 분석합니다.", "Review starts after you submit a new request and the terminal shows that the AI has finished answering. It does not analyze while the AI is answering or awaiting approval. If completion cannot be confirmed, it keeps waiting. Use Review again for existing conversations. Analysis uses the selected model's account allowance and stays separate for each terminal.", "提交新请求并确认终端显示 AI 回答已完成后，才开始审查。回答中或等待批准时不分析。无法确认完成时保持等待。已有对话可使用重新审查按钮。分析会使用所选模型的账户额度，各终端独立分析。"],
  [
    "인스턴스",
    "Instances",
    "独立会话"
  ],
  [
    "작업 폴더 추가",
    "Add workspace folder",
    "添加工作目录"
  ],
  [
    "폴더 추가",
    "Add folder",
    "添加目录"
  ],
  [
    "작업 폴더",
    "Workspace folders",
    "工作目录"
  ],
  [
    "새 터미널 인스턴스",
    "New terminal instance",
    "新建终端会话"
  ],
  [
    "프로젝트 없는 새 인스턴스",
    "New independent instance",
    "新建独立会话"
  ],
  [
    "프로젝트에 속하지 않은 인스턴스",
    "Instances outside projects",
    "不属于项目的会话"
  ],
  [
    "설정 · 단축키",
    "Settings · Shortcuts",
    "设置 · 快捷键"
  ],
  [
    "오른쪽으로 터미널 분할",
    "Split terminal right",
    "向右拆分终端"
  ],
  [
    "아래로 터미널 분할",
    "Split terminal down",
    "向下拆分终端"
  ],
  [
    "오른쪽 분할",
    "Split right",
    "向右拆分"
  ],
  [
    "아래로 분할",
    "Split down",
    "向下拆分"
  ],
  [
    "아래 분할",
    "Split down",
    "向下拆分"
  ],
  [
    "선택한 터미널 넓게 보기",
    "Expand selected terminal",
    "展开所选终端"
  ],
  [
    "이해 · 검토 패널 표시",
    "Show understanding and review",
    "显示理解与审查"
  ],
  [
    "선택한 터미널 이해와 검토",
    "Understanding and review for selected terminal",
    "所选终端的理解与审查"
  ],
  [
    "이해와 검토 패널 접기",
    "Collapse review panel",
    "收起审查面板"
  ],
  [
    "이해 검토 패널 너비",
    "Review panel width",
    "审查面板宽度"
  ],
  [
    "자동 이해 · 검토",
    "Automatic understanding and review",
    "自动理解与审查"
  ],
  [
    "이해 · 검토",
    "Understand · Review",
    "理解 · 审查"
  ],
  [
    "터미널 탭 이동",
    "Switch terminal tab",
    "切换终端标签"
  ],
  [
    "터미널 탭",
    "Terminal tabs",
    "终端标签"
  ],
  [
    "새 터미널",
    "New terminal",
    "新建终端"
  ],
  [
    "터미널 작업 공간",
    "Terminal workspace",
    "终端工作区"
  ],
  [
    "터미널 연결 중",
    "Connecting terminal",
    "正在连接终端"
  ],
  [
    "분할 터미널 이동",
    "Switch split pane",
    "切换拆分窗格"
  ],
  [
    "패널 접기",
    "Collapse panel",
    "收起面板"
  ],
  [
    "현재 터미널 다시 검토",
    "Review this terminal again",
    "重新审查当前终端"
  ],
  [
    "다시 검토",
    "Review again",
    "重新审查"
  ],
  [
    "지금 검토",
    "Review now",
    "立即审查"
  ],
  [
    "Whitebox 설정",
    "Whitebox settings",
    "Whitebox 设置"
  ],
  [
    "설정 닫기",
    "Close settings",
    "关闭设置"
  ],
  [
    "언어 / Language",
    "Language",
    "语言 / Language"
  ],
  [
    "터미널 글자 크기",
    "Terminal font size",
    "终端字号"
  ],
  [
    "이해·검토용 모델",
    "Analysis model",
    "分析模型"
  ],
  [
    "분석 서비스",
    "Analysis service",
    "分析服务"
  ],
  [
    "터미널과 같은 서비스",
    "Same service as terminal",
    "与终端使用相同服务"
  ],
  [
    "Claude 모델",
    "Claude model",
    "Claude 模型"
  ],
  [
    "Codex 모델",
    "Codex model",
    "Codex 模型"
  ],
  [
    "모델 ID 직접 입력",
    "Enter model ID",
    "输入模型 ID"
  ],
  [
    "모델 ID",
    "Model ID",
    "模型 ID"
  ],
  [
    "다음 분석부터 적용됩니다. 터미널에서 작업 중인 AI의 모델은 바꾸지 않습니다. 선택한 서비스의 로그인과 모델 이용 권한이 필요합니다.",
    "Applies to the next analysis. The terminal's working model stays unchanged. Sign in to the selected service with access to the model.",
    "从下一次分析起生效。不会更改终端中工作的模型。需要登录所选服务并具有模型使用权限。"
  ],
  [
    "터미널에 실행 중인 Claude 또는 Codex를 확인하면, 새 출력과 최근 요청의 문맥을 모아 설정에서 선택한 서비스와 모델로 분석합니다. 출력이 약 8초간 잠잠해지면 분석하며, 계속 출력되는 작업은 약 90초마다 중간 내용을 확인합니다. 자동 분석 간격은 최소 45초이며 처리 대기 중에는 더 길어질 수 있습니다. 이용 중인 AI 계정의 사용량이 발생합니다. 다른 터미널의 대화는 합치지 않습니다.",
    "When Claude or Codex is running, new output and recent request context are analyzed using the selected service and model. Analysis starts after about 8 seconds of quiet, or after about 90 seconds of continuous output. Automatic runs are at least 45 seconds apart and may wait longer. This uses your AI account allowance. Each terminal is reviewed separately.",
    "检测到运行中的 Claude 或 Codex 后，使用所选服务和模型分析新输出及近期请求。输出安静约 8 秒后开始分析；持续输出时约每 90 秒分析一次。自动分析至少间隔 45 秒，排队时可能更久。分析会消耗 AI 账户额度，各终端独立审查。"
  ],
  [
    "검토는 관찰한 출력에 대한 AI 해석입니다. 코드와 테스트를 별도로 실행해 보증하지 않으며, 화면에서 사라진 내용은 확인할 수 없을 수 있습니다.",
    "Review is an AI interpretation of observed output. It does not independently run code or tests, and content no longer on screen may be unavailable.",
    "审查是 AI 对已观察输出的解读，不会独立运行代码或测试，可能无法查看已离开屏幕的内容。"
  ],
  [
    "화면 테마 전환",
    "Toggle theme",
    "切换主题"
  ],
  [
    "프로젝트를 목록에서 삭제할까요?",
    "Remove project from the list?",
    "从列表中移除此项目？"
  ],
  [
    "실제 프로젝트 폴더와 파일은 그대로 남습니다.",
    "The project folder and files will be kept.",
    "项目目录和文件将保留。"
  ],
  [
    "프로젝트 삭제",
    "Remove project",
    "移除项目"
  ],
  [
    "취소",
    "Cancel",
    "取消"
  ],
  [
    "인스턴스 휴지통",
    "Instance trash",
    "会话回收站"
  ],
  [
    "휴지통 닫기",
    "Close trash",
    "关闭回收站"
  ],
  [
    "휴지통",
    "Trash",
    "回收站"
  ],
  [
    "삭제한 인스턴스는 실행 상태를 유지합니다. 휴지통에 있는 동안 자동 이해·검토는 멈춥니다.",
    "Trashed instances keep running. Automatic review pauses while they are in the trash.",
    "移入回收站的会话保持运行，期间自动审查暂停。"
  ],
  [
    "인스턴스를 영구 삭제할까요?",
    "Permanently delete this instance?",
    "永久删除此会话？"
  ],
  [
    "실행 중인 프로그램도 종료됩니다. 삭제 후에는 이 인스턴스를 복구할 수 없습니다.",
    "Running programs will stop. This instance cannot be restored after deletion.",
    "运行中的程序也将终止。删除后无法恢复此会话。"
  ],
  [
    "영구 삭제",
    "Delete permanently",
    "永久删除"
  ],
  [
    "실행 중 · 자동 검토 중지",
    "Running · automatic review paused",
    "运行中 · 自动审查已暂停"
  ],
  [
    "종료된 세션 · 기록 복구",
    "Exited session · restore history",
    "已结束的会话 · 恢复记录"
  ],
  [
    "실행 세션 없음 · 새 셸로 복구 (이전 실행·출력은 이어지지 않음)",
    "Session unavailable · restore as a new shell (previous process and output cannot continue)",
    "会话不可用 · 以新 shell 恢复（无法继续之前的进程和输出）"
  ],
  [
    "새 셸로 복구",
    "Restore as new shell",
    "以新 shell 恢复"
  ],
  [
    "복구하지 못했습니다:",
    "Restore failed:",
    "恢复失败："
  ],
  [
    "삭제하지 못했습니다:",
    "Delete failed:",
    "删除失败："
  ],
  [
    "복구",
    "Restore",
    "恢复"
  ],
  [
    "휴지통이 비어 있습니다.",
    "Trash is empty.",
    "回收站为空。"
  ],
  [
    "휴지통으로 이동",
    "Move to trash",
    "移入回收站"
  ],
  [
    "이 인스턴스를 휴지통으로 이동",
    "Move this instance to trash",
    "将此会话移入回收站"
  ],
  [
    "이 프로젝트에 터미널 추가",
    "Add terminal to this project",
    "为此项目添加终端"
  ],
  [
    "프로젝트 목록에서 삭제",
    "Remove from project list",
    "从项目列表移除"
  ],
  [
    "터미널 추가",
    "Add terminal",
    "添加终端"
  ],
  [
    "프로젝트 없는 세션이 여기에 표시됩니다.",
    "Sessions outside projects appear here.",
    "不属于项目的会话显示在这里。"
  ],
  [
    "터미널 입력",
    "Terminal input",
    "终端输入"
  ],
  [
    "터미널 분할 크기",
    "Terminal split size",
    "终端拆分尺寸"
  ],
  [
    "터미널 열기",
    "Open terminal",
    "打开终端"
  ],
  [
    "프로젝트 추가",
    "Add project",
    "添加项目"
  ],
  [
    "터미널에서 바로 시작하세요.",
    "Start in the terminal.",
    "从终端开始。"
  ],
  [
    "셸을 열고 평소처럼 명령어를 입력하세요.",
    "Open a shell and enter commands as usual.",
    "打开 shell，像平时一样输入命令。"
  ],
  [
    "claude, codex도 이 터미널에서 실행합니다.",
    "Run claude or codex in this terminal too.",
    "也可在此终端运行 claude 或 codex。"
  ],
  [
    " 연결된 터미널 ",
    " Connected terminals: ",
    " 关联终端数："
  ],
  [
    "개와 실행 중인 프로그램도 종료됩니다.",
    " and their running programs will stop.",
    "，以及其中运行的程序也将终止。"
  ],
  [
    " 프로젝트를 앱 목록에서 삭제합니다.",
    " will be removed from the project list.",
    "将从项目列表中移除。"
  ],
  [
    "CLI 기본 모델",
    "CLI default model",
    "CLI 默认模型"
  ],
  [
    "이전 기록 · ",
    "Earlier reading · ",
    "此前记录 · "
  ],
  [
    " 약 ",
    " approximately ",
    " 约 "
  ],
  [
    "% 사용",
    "% used",
    "% 已使用"
  ],
  [
    "구독 사용률 확인 중…",
    "Checking subscription usage…",
    "正在查询订阅使用率…"
  ],
  [
    "구독 사용률 확인 불가",
    "Subscription usage unavailable",
    "无法查询订阅使用率"
  ],
  [
    " 확인<br/>",
    " observed<br/>",
    "查询<br/>"
  ],
  [
    "최신 사용률이 아닐 수 있습니다.",
    "This reading may be out of date.",
    "此记录可能不是最新使用率。"
  ],
  [
    "계정 전체 사용량이며 다른 작업도 포함됩니다.",
    "Account-wide usage, including other tasks.",
    "这是账户总使用量，包含其他任务。"
  ],
  [
    "이번 분석만의 한도 소모율은 계산할 수 없습니다.",
    "The allowance used by this analysis alone cannot be calculated.",
    "无法计算仅本次分析消耗的额度比例。"
  ],
  [
    "직접 입력",
    "Custom model ID",
    "自定义模型 ID"
  ],
  [
    "다음 분석부터 선택한 모델을 사용합니다.",
    "The selected model will be used for the next analysis.",
    "下一次分析将使用所选模型。"
  ],
  [
    "모델 ID의 형식을 확인해 주세요.",
    "Check the model ID format.",
    "请检查模型 ID 格式。"
  ],
  [
    "다음 분석부터 적용됩니다.",
    "Applies to the next analysis.",
    "从下一次分析起生效。"
  ],
  [
    "선택한 터미널 없음",
    "No terminal selected",
    "未选择终端"
  ],
  [
    "현재 탭 · ",
    "Current tab · ",
    "当前标签 · "
  ],
  [
    "터미널을 먼저 열어 주세요",
    "Open a terminal first",
    "请先打开终端"
  ],
  [
    "터미널을 클릭하면 이 패널도 해당 터미널의 검토로 바뀝니다.",
    "Click a terminal to see its review here.",
    "点击终端即可在此查看对应的审查。"
  ],
  [
    "현재 터미널 검토",
    "Current terminal",
    "当前终端审查"
  ],
  [
    "자동 검토 꺼짐",
    "Automatic review off",
    "自动审查已关闭"
  ],
  [
    "요청과 출력을 기다리는 중",
    "Waiting for requests and output",
    "等待请求与输出"
  ],
  [
    "새 출력 모으는 중",
    "Collecting new output",
    "正在收集新输出"
  ],
  [
    "셸 사용 중",
    "Shell active",
    "Shell 使用中"
  ],
  [
    "연결 확인 필요",
    "Connection needs attention",
    "请检查连接"
  ],
  [
    "분석중…",
    "Analyzing…",
    "正在分析…"
  ],
  [
    "관찰한 내용의 AI 해석",
    "AI interpretation of observed output",
    "AI 对已观察输出的解读"
  ],
  [
    "검토를 완료하지 못했습니다",
    "Review could not finish",
    "未能完成审查"
  ],
  [
    "내 요청과 AI가 한 일을 비교하고 있어요.",
    "Comparing your request with the AI's work.",
    "正在比较您的请求与 AI 的工作。"
  ],
  [
    "초 경과",
    " seconds elapsed",
    "秒已过"
  ],
  [
    "최대 3분 후 시간 초과로 종료됩니다.",
    "Times out after 3 minutes.",
    "最多 3 分钟后超时结束。"
  ],
  [
    "분석이 끝나면 여기에 표시됩니다.",
    "Results will appear here.",
    "分析完成后将在此显示结果。"
  ],
  [
    "터미널 작업은 계속할 수 있어요.",
    "You can keep working in the terminal.",
    "您可以继续在终端工作。"
  ],
  [
    "작업하면, 이해도 함께.",
    "Understand as you work.",
    "边工作，边理解。"
  ],
  [
    "이 터미널에서 AI에게 요청하면",
    "Ask the AI in this terminal; we compare",
    "在此终端向 AI 提出请求，"
  ],
  [
    "말한 내용과 작업 결과를 비교합니다.",
    "your request with its reported work.",
    "我们会比较您的要求与工作结果。"
  ],
  [
    "터미널에서 ",
    "In the terminal, run ",
    "在终端中运行 "
  ],
  [
    " 또는 ",
    " or ",
    " 或 "
  ],
  [
    " 실행</p>",
    "</p>",
    "</p>"
  ],
  [
    "평소처럼 자연어로 작업 요청",
    "Describe your task as usual",
    "像平时一样用自然语言提出任务"
  ],
  [
    "요청 · 실제 작업 · 차이를 이곳에서 확인",
    "See your request, the work, and any differences here",
    "在此查看请求、实际工作与差异"
  ],
  [
    "화면 기록을 설정한 모델로 분석합니다.",
    "The selected model analyzes captured terminal output.",
    "使用所选模型分析终端画面记录。"
  ],
  [
    "AI 계정의 사용량이 발생하며 설정에서 끌 수 있습니다.",
    "Uses your AI allowance; you can turn it off in settings.",
    "会消耗 AI 账户额度，可在设置中关闭。"
  ],
  [
    "이전 분석 결과 · ",
    "Previous analysis · ",
    "上次分析 · "
  ],
  [
    "개 요청 · ",
    " requests · ",
    "个请求 · "
  ],
  [
    "새 출력 반영 대기",
    "New output awaiting analysis",
    "新输出等待分析"
  ],
  [
    " 기준</span>",
    "</span>",
    "为准</span>"
  ],
  [
    "출력상 요청과 맞아요",
    "Reported work matches the request",
    "输出中的工作符合请求"
  ],
  [
    "요청과 다른 부분이 있어요",
    "Some work differs from the request",
    "部分工作与请求不同"
  ],
  [
    "아직 확인이 필요해요",
    "More evidence needed",
    "仍需更多证据"
  ],
  [
    "이해하기",
    "Understand",
    "理解"
  ],
  [
    "확인할 부분",
    "What to check",
    "待确认事项"
  ],
  [
    "검증 상태",
    "Verification",
    "验证状态"
  ],
  [
    "내 요청",
    "Your request",
    "您的请求"
  ],
  [
    "AI가 한 일",
    "What the AI did",
    "AI 所做的工作"
  ],
  [
    "이전 요청 ",
    "Earlier request ",
    "此前请求 "
  ],
  [
    "이전 터미널에는 검토 연결 식별자가 없습니다. 새 터미널을 열면 이해·검토가 연결됩니다.",
    "This older terminal has no review identity. Open a new terminal to connect review.",
    "旧终端没有审查连接标识。请打开新终端以连接审查。"
  ],
  [
    "기존 배치로 돌아가기",
    "Restore layout",
    "恢复布局"
  ],
  [
    "Whitebox 앱에서 실행해 주세요.",
    "Open this in Whitebox.",
    "请在 Whitebox 应用中打开。"
  ],
  [
    "내 작업 공간",
    "My workspace",
    "我的工作区"
  ],
  [
    "셸 다시 연결 중…",
    "Reconnecting shell…",
    "正在重新连接 shell…"
  ],
  [
    "셸 연결됨",
    "Shell connected",
    "Shell 已连接"
  ],
  [
    "실행 중",
    "Running",
    "运行中"
  ],
  [
    "종료됨",
    "Exited",
    "已结束"
  ],
  [
    "개 터미널",
    " terminals",
    "个终端"
  ],
  [
    "터미널",
    "Terminal",
    "终端"
  ],
  [
    "분할",
    "Split",
    "拆分"
  ],
  [
    " 삭제",
    " Delete",
    " 删除"
  ]
];
  const bySource = new Map(messages.map(row => [row[0], row]));
  const pattern = new RegExp(messages.map(row => row[0]).sort((a, b) => b.length - a.length).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu');
  function t(source) {
    const locale = window.WhiteboxI18n?.getLocale() || 'ko';
    const column = { en: 1, 'zh-CN': 2 }[locale];
    return column ? source.replace(pattern, key => bySource.get(key)[column]) : source;
  }
  const msg = (parts, ...values) => parts.map((part, index) => t(part) + (index < values.length ? values[index] : '')).join('');
  window.WhiteboxWorkspaceI18n = Object.freeze({ t, msg });
})();
