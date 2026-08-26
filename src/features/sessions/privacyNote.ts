/** Shown to students on the survey page; stored in the session's public config. */
export const DEFAULT_PRIVACY_NOTE = `Your privacy is protected by design:
• You are identified only by your random login code. This platform never receives your name or email — your instructor knows who you are, but never uploads that here.
• Your answers are encrypted in your browser before they are uploaded, so the platform only ever stores unreadable ciphertext. The decryption key is never sent to the server — only your instructor can unlock your answers.
• Your instructor can permanently erase all survey data for this session at any time, and is encouraged to do so once teams are formed.
• You can change or withdraw your answers any time while the survey is open.`;

/** Appended to the privacy note when team management is enabled. */
export const TEAM_MGMT_PRIVACY_NOTE = `Team management (contracts & peer evaluations):
• Your instructor uploads only which team you are on — no names. You choose the display name your team and your instructor see, and it is encrypted in your browser, so the platform stores it unreadable. Use your real name or anything else you like; just tell your teammates which name you picked.
• Your team contract is encrypted for your team and shared with your instructor as you write it — they can read drafts, not just the final version. Nobody outside your team and your instructor can.
• Your peer evaluations are encrypted so that only your instructor can read them; your teammates never see your answers.
• When results are returned to you, they are encrypted so that only you can open them.
• AI feedback is optional: if your team requests it, only the contract text — no names — is sent to an AI service outside this end-to-end encryption to generate suggestions.`;
