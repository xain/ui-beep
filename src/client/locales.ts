/** `settings.beep` namespace dictionaries (the UI Beep settings section copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '提示音',
  'title': '提示音',
  'intro': '不同状态下的提示音音量，调整后立即生效',
  'enabled.title': '启用提示音',
  'enabled.description': '关闭后所有提示音静音',
  'master.title': '总音量',
  'master.description': '叠加到每种提示音之上',
  'tick.title': '输出提示音',
  'tick.description': '会话流式输出内容时',
  'hum.title': '工作提示音',
  'hum.description': 'Agent 忙碌工作时（心跳）',
  'chime.title': '等待提示音',
  'chime.description': '会话等待你的输入时',
  'percent': '{value}%',
  'preview': '试听',
  'previewTick': '试听输出提示音',
  'previewHum': '试听工作提示音',
  'previewChime': '试听等待提示音',
} satisfies Record<string, string>

/** The settings.beep namespace key union. */
export type BeepKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'nav': 'Sound',
  'title': 'Sound',
  'intro': 'Volume of the beep for each state; changes apply immediately',
  'enabled.title': 'Enable beeps',
  'enabled.description': 'Mutes every beep while off',
  'master.title': 'Master volume',
  'master.description': 'Applied on top of every beep',
  'tick.title': 'Streaming beep',
  'tick.description': 'While a session streams output',
  'hum.title': 'Working beep',
  'hum.description': 'While an agent is busy (heartbeat)',
  'chime.title': 'Waiting beep',
  'chime.description': 'While a session awaits your input',
  'percent': '{value}%',
  'preview': 'Preview',
  'previewTick': 'Preview the streaming beep',
  'previewHum': 'Preview the working beep',
  'previewChime': 'Preview the waiting beep',
} satisfies Record<BeepKey, string>