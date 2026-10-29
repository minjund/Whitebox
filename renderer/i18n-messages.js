'use strict';

// Stable messages used by the current workspace, PTY runtime and settings.
window.WhiteboxMessages = Object.freeze({
  "app.document.title": {"ko":"Whitebox · AI 작업 도우미","en":"Whitebox · AI Work Assistant","zh-CN":"Whitebox · AI 工作助手"},
  "settings.theme.current_light": {"ko":"화면 색상","en":"Screen color","zh-CN":"画面颜色"},
  "settings.theme.current_dark": {"ko":"화면 색상","en":"Screen color","zh-CN":"画面颜色"},
  "settings.theme.switch_to_light": {"ko":"밝은 화면으로 바꾸기","en":"Switch to a light screen","zh-CN":"切换为亮色屏幕"},
  "settings.theme.switch_to_dark": {"ko":"어두운 화면으로 바꾸기","en":"Switch to a dark screen","zh-CN":"切换为暗色屏幕"},
  "settings.attention_popups.enabled": {"ko":"켜짐 · 요청이 오면 오른쪽 아래에 표시","en":"On · requests appear at the bottom right","zh-CN":"已开启 · 请求会显示在右下角"},
  "settings.attention_popups.disabled": {"ko":"꺼짐 · 팝업을 표시하지 않음","en":"Off · no interactive popups","zh-CN":"已关闭 · 不显示交互弹窗"},
  "settings.attention_popups.hook_warning": {"ko":"켜짐 · 응답 연결 경고: {detail}","en":"On · response connection warning: {detail}","zh-CN":"已开启 · 响应连接警告：{detail}"},
  "settings.attention_popups.hook_error": {"ko":"켜짐 · 응답 연결 오류: {detail}","en":"On · response connection error: {detail}","zh-CN":"已开启 · 响应连接错误：{detail}"},
  "settings.attention_popups.hook_review_required": {"ko":"켜짐 · 연결 설정 확인 필요: {detail}","en":"On · connection settings need review: {detail}","zh-CN":"已开启 · 需要检查连接设置：{detail}"},
  "settings.attention_popups.hook_detail_unavailable": {"ko":"추가 세부 정보가 없습니다.","en":"No additional detail was provided.","zh-CN":"未提供其他详细信息。"},
  "settings.attention_popups.enabled_toast": {"ko":"권한·질문 팝업을 켰습니다.","en":"Permission and question popups are on.","zh-CN":"已开启权限与问题弹窗。"},
  "settings.attention_popups.disabled_toast": {"ko":"권한·질문 팝업을 끄고 열린 창을 닫았습니다.","en":"Permission and question popups are off and open popups were closed.","zh-CN":"已关闭权限与问题弹窗及所有已打开的弹窗。"},
  "settings.attention_popups.save_failed": {"ko":"팝업 설정을 저장하지 못했습니다.","en":"Could not save popup settings.","zh-CN":"无法保存弹窗设置。"},
  "terminal.error.initialization_failed": {"ko":"컴퓨터 작업을 준비하지 못했습니다: {message}","en":"Failed to prepare the computer work screen: {message}","zh-CN":"无法准备电脑任务画面：{message}"},
  "terminal.error.input_failed": {"ko":"선택한 작업에 내용을 보내지 못했습니다.","en":"Could not send input to the selected work.","zh-CN":"无法向所选任务发送内容。"},
  "terminal.error.screen_unavailable": {"ko":"컴퓨터 작업 화면을 불러오지 못했습니다.","en":"Could not load the computer work screen.","zh-CN":"无法加载电脑任务画面。"},
  "terminal.error.unknown": {"ko":"컴퓨터 작업을 완료하지 못했습니다. 잠시 후 다시 시도하세요.","en":"Could not complete the computer work. Try again shortly.","zh-CN":"无法完成电脑任务，请稍后重试。"},
  "comprehension.prompt_empty": {"ko":"작업 내용을 입력하세요.","en":"Enter the task details.","zh-CN":"请输入任务内容。"}
});
