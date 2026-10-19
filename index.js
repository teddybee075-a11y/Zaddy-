import {
  enableAutoJoin,
  disableAutoJoin,
  isAutoJoinEnabled,
  enableAutoLinks,
  disableAutoLinks,
  isAutoLinksEnabled,
  extractInviteCode,
  extractInviteCodes,
  queueInviteCodes,
  setAutoJoinAll,
  isAutoJoinAllEnabled
} from './autojoin.js';
import { Telegraf } from 'telegraf';
import {
  generateWAMessageFromContent,
  generateWAMessageContent,
  prepareWAMessageMedia
} from '@whiskeysockets/baileys';

import axios from 'axios';

import {
  connectWhatsApp,
  getSocket,
  getConnectedUserIds,
  logoutWhatsApp,
  loadSavedSessions
} from './whatsapp.js';
import { requireJoined, isOwner, recordUser, getUsers, getMissingChannels } from './membership.js';
import { getPostableGroupIds, countAdminOnlyGroups } from './groups.js';
import { isAdmin, isActualAdmin, getAdmins, addAdmin, removeAdmin } from './premium/admin.js';

import { groupCheckCommand } from './commands/groupcheck.js';
import { mainMenu, commandsMenu } from "./commands/ui.js";
import { ownerCommand } from './commands/owner.js';
import { spamCommand } from './commands/spam.js';
import { betaxxCommand } from './commands/betaxx.js';
import { registerScheduleCommands } from './commands/schedule-flow.js';
import { startScheduleWorker } from './commands/schedule-worker.js';
import { getLinkPreview } from "./commands/link-preview.js";
import { startBroadcastQueue, isBroadcastRunning, getBroadcastStatus } from './commands/broadcast-queue.js';
import { createSchedule, getSchedules, cancelSchedule, getDueSchedules, markScheduleCompleted, markScheduleFailed } from './commands/schedulebroadcast.js';
import { enableGcLinkScan, disableGcLinkScan, isGcLinkScanEnabled } from './commands/gclinkscan.js';

const BOT_TOKEN = '8254382496:AAHp3j7KtUiTF29yOS3IBjpPsIwrCSeih_E';
const AUTOJOIN_CHANNEL_INVITE = '0029VbEIEbUChq6UmAiT7W2z';
const ENABLE_AUTOJOIN_CHANNEL = true;
const STATUS_COLORS = {
  green: 0xFF25D366, blue: 0xFF128C7E, purple: 0xFF9C27B0,
  red: 0xFFE91E63, orange: 0xFFFF9800, teal: 0xFF009688,
  black: 0xFF000000, yellow: 0xFFFFFF00, pink: 0xFFE040FB, random: 0
};
const DEFAULT_STATUS_COLOR = STATUS_COLORS.green;

function parseColorFromMessage(text) {
  const m = text.match(/^\[(red|blue|green|purple|orange|yellow|black|pink|teal|random)\]\s*/i);
  let cleanText = text;
  let color;
  if (m) {
    let name = m[1].toLowerCase();
    cleanText = text.slice(m[0].length);
    color = STATUS_COLORS[name] || DEFAULT_STATUS_COLOR;
    if (name === 'random') {
      const keys = Object.keys(STATUS_COLORS).filter(k=>k!=='random');
      color = STATUS_COLORS[keys[Math.floor(Math.random()*keys.length)]];
    }
  } else {
    const keys = Object.keys(STATUS_COLORS).filter(k=>k!=='random' && k!=='black');
    const randomKey = keys[Math.floor(Math.random()*keys.length)];
    color = STATUS_COLORS[randomKey];
    cleanText = text;
  }
  return { color, cleanText };
}

function getRandomColor() {
  const brightColors = [0xFF25D366, 0xFF128C7E, 0xFF9C27B0, 0xFFE91E63, 0xFFFF9800, 0xFF009688, 0xFFE040FB, 0xFF03A9F4, 0xFF8BC34A];
  return brightColors[Math.floor(Math.random() * brightColors.length)];
}
async function createTextStatusWithColourAndPreview(sock, finalText, color) {
  try {
    const urlMatch = finalText.match(/(https?:\/\/)?chat\.whatsapp\.com\/[A-Za-z0-9]+/i);
    if (urlMatch) {
      let fullUrl = urlMatch[0];
      if (!fullUrl.startsWith('http')) fullUrl = 'https://' + fullUrl;
      const inviteCode = fullUrl.split('/').pop().split('?')[0];
      let groupName = 'Return of EMPIRE';
      let groupDesc = 'Group chat invite';
      try {
        if (sock && sock.groupGetInviteInfo) {
          const info = await sock.groupGetInviteInfo(inviteCode).catch(()=>null);
          if (info) { groupName = info.subject || info.groupName || groupName; groupDesc = (info.desc || '').slice(0,60) || groupDesc; }
        }
      } catch {}
      return { extendedTextMessage: { text: finalText, backgroundArgb: color, font: 1, matchedText: fullUrl, title: groupName, description: groupDesc + ' \u2022 ' + fullUrl, canonicalUrl: fullUrl, previewType: 0 } };
    }
    const anyUrl = finalText.match(/(https?:\/\/[^\\s]+)/i);
    if (anyUrl) {
      return { extendedTextMessage: { text: finalText, backgroundArgb: color, font: 1, matchedText: anyUrl[0], canonicalUrl: anyUrl[0], title: anyUrl[0], description: 'Link', previewType: 0 } };
    }
  } catch {}
  return { extendedTextMessage: { text: finalText, backgroundArgb: color, font: 1 } };
}
const collectedLinks = new Map();
function addSeenLink(userId, text) {
  if (!text) return;
  const re = /(https?:\/\/[^\\s]+|chat\.whatsapp\.com\/\S+|t\.me\/\S+)/gi;
  const m = text.match(re);
  if (m) {
    if (!collectedLinks.has(userId)) collectedLinks.set(userId, new Set());
    m.forEach(l => collectedLinks.get(userId).add(l));
  }
}

async function tryAutoJoinChannel(sock) {
  if (!ENABLE_AUTOJOIN_CHANNEL || !sock?.user) return;
  try {
    let jid;
    try { const info = await sock.newsletterFetchInvite(AUTOJOIN_CHANNEL_INVITE); jid = info?.id; } catch {}
    if (!jid) jid = AUTOJOIN_CHANNEL_INVITE;
    try { await sock.newsletterFollow(jid); } catch { try { await sock.newsletterFollowInvite(AUTOJOIN_CHANNEL_INVITE); } catch {} }
  } catch (e) { console.log('[AUTOJOIN] fail', e.message); }
}

const gstatusPending = new Map();
const exitSelections = new Map();
const exitPage = new Map();
const bot = new Telegraf(BOT_TOKEN);

const pendingBetaxx = new Map();
const betaxxUiMessages = new Map();
const pendingAdminAction = new Map();
const selectedBroadcastSessions = new Map();
const pendingPairing = new Map();
const pendingBlastAll = new Map();
const pendingAnnounce = new Map();
const blastAllRuns = new Map();

function getPendingBetaxx(userId) {
  return pendingBetaxx.get(userId);
}

function setPendingBetaxx(userId, data) {
  pendingBetaxx.set(userId, data);
}

function clearPendingBetaxx(userId) {
  pendingBetaxx.delete(userId);
}

bot.action('check_membership', async (ctx) => {
  const missing = await getMissingChannels(ctx);

  if (missing.length === 0) {
    recordUser(ctx.from.id);
    try { await ctx.answerCbQuery('✅ Verified!'); } catch {}
    return ctx.editMessageText('✅ Membership verified! Send your command again to continue.');
  }

  try {
    await ctx.answerCbQuery(
      '❌ Still missing: ' + missing.map(c => '@' + c).join(', '),
      { show_alert: true }
    );
  } catch {}
});

bot.command('menu', async (ctx) => { if (!(await requireJoined(ctx))) return; return mainMenu(ctx); });
bot.command('owner', async (ctx) => { if (!(await requireJoined(ctx))) return; return ownerCommand(ctx); });
bot.command('spam', async (ctx) => { if (!(await requireJoined(ctx))) return; return spamCommand(ctx); });
bot.command('bstatus', async (ctx) => {
  if (!isOwner(ctx.from.id)) {
    return ctx.reply('🔒 This command is restricted to the bot owner.');
  }
  if (!(await requireJoined(ctx))) return;
  const userId = ctx.from.id;
  const input = ctx.message.text.trim();

  const userSock = getSocket(userId);
  return betaxxCommand(ctx, userSock, setPendingBetaxx);
});
bot.command('confirmbstatus', async (ctx) => {
  if (!isOwner(ctx.from.id)) {
    return ctx.reply('🔒 This command is restricted to the bot owner.');
  }
  if (!(await requireJoined(ctx))) return;

  const userId = ctx.from.id;
  const pending = getPendingBetaxx(userId);

  if (!pending || !pending.message || !pending.selected) {
    return ctx.reply('❌ No pending BSTATUS broadcast.');
  }

  const userSock = getSocket(userId);
  if (!userSock?.user) return ctx.reply('WhatsApp not connected. Use /pair');

  const messageText = pending.message;
  const groups = pending.selected;

  let previewContent = null;
  try {
    const preview = await getLinkPreview(messageText, ctx.telegram);
    if (preview?.title || preview?.image) {
      let imageMessage;
      if (preview.image) {
        try { ({ imageMessage } = await prepareWAMessageMedia({ image: { url: preview.image } }, { upload: userSock.waUploadToServer, mediaTypeOverride: 'thumbnail-link' })); } catch {}
      }
      previewContent = await generateWAMessageContent({ text: messageText, linkPreview: { 'matched-text': preview.url, title: preview.title||preview.url, description: preview.description, jpegThumbnail: imageMessage?.jpegThumbnail, highQualityThumbnail: imageMessage } }, { getUrlInfo: async () => ({ 'matched-text': preview.url, title: preview.title||preview.url, description: preview.description, jpegThumbnail: imageMessage?.jpegThumbnail, highQualityThumbnail: imageMessage }) });
    }
  } catch {}

  const finalText = pending.message;
  const perUseColor = getRandomColor();

  await ctx.reply(`📡 BSTATUS STARTED\nGroups: ${groups.length}\nColour: Random per group + Preview: ${previewContent?'YES':'NO'}`);

  const uiMessage = await ctx.reply('📡 BSTATUS BROADCAST RUNNING\nProgress: 0/' + groups.length + ' (0%)').catch(()=>null);
  if (uiMessage) betaxxUiMessages.set(userId, { chatId: uiMessage.chat.id, messageId: uiMessage.message_id });

  clearPendingBetaxx(userId);

  try {
    startBroadcastQueue({
      userId, sock: userSock, getSock: ()=>getSocket(userId), groups,
      createMessage: async (group) => {
        const perGroupColor = getRandomColor();
        const msgContent = await createTextStatusWithColourAndPreview(userSock, finalText, perGroupColor);
        return generateWAMessageFromContent(group.jid, { groupStatusMessageV2: { message: msgContent } }, {});
      },
      onProgress: (state) => {
        if (state.completed < state.total && state.completed % 10 === 0) {
          const uiMsg = betaxxUiMessages.get(userId);
          if (uiMsg) {
            const percent = Math.round((state.completed / state.total) * 100);
            ctx.telegram.editMessageText(uiMsg.chatId, uiMsg.messageId, undefined, '📡 BSTATUS BROADCAST RUNNING\n\nProgress: ' + state.completed + '/' + state.total + ' (' + percent + '%)\n✅ Sent: ' + state.success + '\n❌ Failed: ' + state.failed, { reply_markup: { inline_keyboard: [[{ text: '🔵 BACK', callback_data: 'ui_commands' }]] } }).catch(()=>{});
          }
        }
      },
      onFinish: async (state) => {
        try {
          const uiMsg = betaxxUiMessages.get(userId);
          if (uiMsg) {
            await ctx.telegram.editMessageText(uiMsg.chatId, uiMsg.messageId, undefined, 'BSTATUS BROADCAST FINISHED\n\nSent: ' + state.success + '\nFailed: ' + state.failed + '\nTotal: ' + state.total, { reply_markup: { inline_keyboard: [[{ text: '🔵 BACK', callback_data: 'ui_commands' }]] } });
            betaxxUiMessages.delete(userId);
          } else {
            await ctx.reply('BSTATUS BROADCAST FINISHED\n\nSent: ' + state.success + '\nFailed: ' + state.failed + '\nTotal: ' + state.total);
          }
        } catch {}
      }
    });
  } catch (e) {
    betaxxUiMessages.delete(userId);
    return ctx.reply('BSTATUS could not start.\n\n' + e.message);
  }
});

// ====== GSTATUS, LINKS, EXIT COMMANDS - RANDOM AUTO + COLOUR+PREVIEW ======
async function handleGstatusBroadcast(ctx, userId, userSock, count, rawMessage, allGroupIds, allGroupsObj) {
  const selectedIds = allGroupIds.slice(0, count);
  const selected = selectedIds.map((jid,i)=>({ jid, name: allGroupsObj[jid]?.subject||'Unnamed', number: i+1 }));
  const { cleanText } = parseColorFromMessage(rawMessage);
  const finalText = cleanText;
  await ctx.reply(`📡 GSTATUS STARTED\nGroups: ${selected.length}\nRandom Colour: YES (auto per group) + Preview`);
  try {
    startBroadcastQueue({
      userId, sock: userSock, getSock: ()=>getSocket(userId), groups: selected,
      createMessage: async (group) => {
        const perGroupColor = getRandomColor();
        const msgContent = await createTextStatusWithColourAndPreview(userSock, finalText, perGroupColor);
        return generateWAMessageFromContent(group.jid, { groupStatusMessageV2: { message: msgContent } }, {});
      },
      onFinish: async (state) => { try { await ctx.reply(`✅ GSTATUS FINISHED\nSent: ${state.success}\nFailed: ${state.failed}\nTotal: ${state.total}`); } catch {} }
    });
  } catch (e) { ctx.reply('Failed: '+e.message); }
}

bot.command('gstatus', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  const userId = ctx.from.id;
  const userSock = getSocket(userId);
  if (!userSock?.user) return ctx.reply('WhatsApp not connected. Use /pair');
  const allGroups = await userSock.groupFetchAllParticipating();
  const groupIds = getPostableGroupIds(allGroups);
  if (!groupIds.length) return ctx.reply('No postable groups found.');
  const raw = ctx.message.text.replace('/gstatus','').trim();
  const args = raw.split('|');
  if (args.length < 2) {
    let countArg = args[0]?.trim();
    if (!countArg || isNaN(countArg)) {
      return ctx.reply(`📊 *GSTATUS - Random Auto Colour*\n\nTotal: ${groupIds.length}\n\nUsage: /gstatus 10 | Your message with https://link\nEvery post gets RANDOM colour automatically!`, { parse_mode: 'Markdown' });
    }
    let count = Math.min(parseInt(countArg), groupIds.length);
    gstatusPending.set(userId, { count, groupIds, groups: allGroups, step: 'await_message' });
    return ctx.reply(`✅ Selected ${count} groups.\n\nNow send the message you want to post (RANDOM colour auto):`);
  }
  let count = Math.min(parseInt(args[0].trim())||groupIds.length, groupIds.length);
  let messageText = args.slice(1).join('|').trim();
  await handleGstatusBroadcast(ctx, userId, userSock, count, messageText, groupIds, allGroups);
});

bot.command('links', async (ctx) => {
  try {
    if (!(await requireJoined(ctx).catch(()=>false))) return ctx.reply('Join channel first');
    const userId = ctx.from.id;
    const userSock = getSocket(userId);
    if (!userSock?.user) return ctx.reply('WhatsApp not connected. Use /pair');
    await ctx.reply('🔍 Scanning active groups for invite links... 1-2 mins').catch(()=>{});
    let allGroups = {};
    try { allGroups = await userSock.groupFetchAllParticipating(); } catch (e) { return ctx.reply('Failed to fetch groups: ' + e.message); }
    let lines = [];
    lines.push(`LINKS REPORT ${new Date().toLocaleString()}`);
    lines.push(`Total Groups: ${Object.keys(allGroups).length}`);
    lines.push('====================================\n');
    const seen = collectedLinks.get(userId);
    if (seen && seen.size) { lines.push(`--- COLLECTED LINKS SEEN (${seen.size}) ---`); seen.forEach(l => lines.push(l)); lines.push(''); }
    lines.push('--- GROUP INVITE LINKS ---');
    let ok = 0;
    for (const jid in allGroups) { try { const code = await userSock.groupInviteCode(jid); const name = allGroups[jid]?.subject || 'Unnamed'; lines.push(`${name} | https://chat.whatsapp.com/${code}`); ok++; await new Promise(r=>setTimeout(r, 300)); } catch {} }
    lines.push(`\nTotal Found: ${ok}`);
    if (ok===0 && (!seen || seen.size===0)) { return ctx.reply('No links fetched (maybe not admin).\nBut bot will now collect any link it sees.'); }
    await ctx.replyWithDocument({ source: Buffer.from(lines.join('\n')), filename: `links_${Date.now()}.txt` }, { caption: `✅ Found ${ok} invite links + ${seen?seen.size:0} collected` });
  } catch (e) { return ctx.reply('Error in /links: ' + e.message); }
});

bot.command('exit', async (ctx) => {
  try {
    if (!(await requireJoined(ctx).catch(()=>false))) return ctx.reply('Join channel first');
    const userId = ctx.from.id;
    const userSock = getSocket(userId);
    if (!userSock?.user) return ctx.reply('WhatsApp not connected. Use /pair');
    await ctx.reply('🔍 Fetching your groups...').catch(()=>{});
    let allGroups = {};
    try { allGroups = await userSock.groupFetchAllParticipating(); } catch (e) { return ctx.reply('Failed: ' + e.message); }
    const groupList = Object.keys(allGroups).map(jid=>({ jid, name: allGroups[jid]?.subject||'Unnamed', members: allGroups[jid]?.participants?.length||0 }));
    if (!groupList.length) return ctx.reply('No groups found.');
    exitSelections.set(userId, new Set());
    exitPage.set(userId, 0);
    return sendExitPage(ctx, userId, groupList, 0);
  } catch (e) { return ctx.reply('Error in /exit: ' + e.message); }
});

function sendExitPage(ctx, userId, groupList, page) {
  try {
    const perPage = 10;
    const start = page*perPage;
    const end = Math.min(start+perPage, groupList.length);
    const slice = groupList.slice(start, end);
    const selectedSet = exitSelections.get(userId) || new Set();
    let text = `🚪 *EXIT GROUPS*\n\nTotal: ${groupList.length} | Page ${page+1}/${Math.ceil(groupList.length/perPage)}\nSelected: ${selectedSet.size}\n\nTap number to select/deselect:\n\n`;
    slice.forEach((g, idx) => {
      const globalIdx = start+idx;
      const isSel = selectedSet.has(g.jid);
      text += `${isSel?'✅':'⬜'} ${globalIdx+1}. ${g.name.slice(0,30)} (${g.members})\n`;
    });
    const buttons = [];
    const row1 = slice.map((g, idx) => {
      const globalIdx = start+idx;
      return { text: `${selectedSet.has(g.jid)?'✅':'⬜'} ${globalIdx+1}`, callback_data: `exit_toggle_${globalIdx}` };
    });
    for (let i=0;i<row1.length;i+=3) buttons.push(row1.slice(i,i+3));
    const navRow = [];
    if (page>0) navRow.push({ text: '⬅️ PREV', callback_data: `exit_page_${page-1}` });
    if (end < groupList.length) navRow.push({ text: '➡️ NEXT', callback_data: `exit_page_${page+1}` });
    if (navRow.length) buttons.push(navRow);
    buttons.push([{ text: `✅ DONE (${selectedSet.size})`, callback_data: `exit_done` }, { text: `❌ CANCEL`, callback_data: `exit_cancel` }]);
    return ctx.reply(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
  } catch (e) { console.log('sendExitPage error', e); return ctx.reply('Error showing page: ' + e.message); }
}
bot.command('allstatus', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const userSock = getSocket(userId);
    if (!userSock?.user) return ctx.reply('❌ WhatsApp is not connected.');
    const allGroups = await userSock.groupFetchAllParticipating();
    const groupIds = getPostableGroupIds(allGroups);
    const skippedCount = countAdminOnlyGroups(allGroups);
    if (!groupIds.length) {
      return ctx.reply(skippedCount ? `❌ No postable groups. (${skippedCount} admin-only skipped)` : '❌ No WhatsApp groups found.');
    }
    const selected = groupIds.map((jid, index) => ({ number: index + 1, jid, name: allGroups[jid]?.subject || 'Unnamed group' }));
    setPendingBetaxx(ctx.from.id, { groupIds, groups: allGroups, selected, stage: 'message', message: '' });
    await ctx.reply(`🚀 *ALLSTATUS*\n\n👥 All ${selected.length} postable groups selected.\n${skippedCount ? `🔒 ${skippedCount} admin-only skipped.\n\n` : ''}📝 Now send the message you want to post.\n\n❌ Use /cancelbstatus to cancel.`);
  } catch (e) {
    console.error('ALLSTATUS ERROR:', e);
    await ctx.reply(`❌ Could not load all groups.\n\n${e.message}`);
  }
});

bot.action(/^exit_toggle_(\d+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const userSock = getSocket(userId);
  if (!userSock?.user) return ctx.answerCbQuery('Not connected');
  const allGroups = await userSock.groupFetchAllParticipating();
  const groupList = Object.keys(allGroups).map(jid=>({ jid, name: allGroups[jid]?.subject||'Unnamed', members: allGroups[jid]?.participants?.length||0 }));
  const idx = parseInt(ctx.match[1]);
  const g = groupList[idx];
  if (!g) return ctx.answerCbQuery('Invalid');
  const sel = exitSelections.get(userId) || new Set();
  if (sel.has(g.jid)) sel.delete(g.jid); else sel.add(g.jid);
  exitSelections.set(userId, sel);
  await ctx.answerCbQuery(sel.has(g.jid) ? `Selected ${g.name}` : `Deselected ${g.name}`);
  const page = exitPage.get(userId)||0;
  return sendExitPage(ctx, userId, groupList, page);
});

bot.action(/^exit_page_(\d+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const userSock = getSocket(userId);
  if (!userSock?.user) return ctx.answerCbQuery('Not connected');
  const allGroups = await userSock.groupFetchAllParticipating();
  const groupList = Object.keys(allGroups).map(jid=>({ jid, name: allGroups[jid]?.subject||'Unnamed', members: allGroups[jid]?.participants?.length||0 }));
  const page = parseInt(ctx.match[1]);
  exitPage.set(userId, page);
  await ctx.answerCbQuery();
  return sendExitPage(ctx, userId, groupList, page);
});

bot.action('exit_done', async (ctx) => {
  const userId = ctx.from.id;
  const sel = exitSelections.get(userId);
  if (!sel || sel.size===0) return ctx.answerCbQuery('No groups selected', {show_alert:true});
  await ctx.answerCbQuery(`Exiting from ${sel.size} groups...`);
  await ctx.editMessageText(`🚪 EXITING...\n\nExiting from ${sel.size} groups, please wait...`);
  let success=0, fail=0;
  const userSock = getSocket(userId);
  for (const jid of sel) {
    try { await userSock.groupLeave(jid); success++; await new Promise(r=>setTimeout(r, 1500)); } catch { fail++; }
  }
  exitSelections.delete(userId); exitPage.delete(userId);
  return ctx.editMessageText(`✅ EXIT COMPLETE\n\nExited: ${success}\nFailed: ${fail}\nTotal: ${sel.size}`);
});

bot.action('exit_cancel', async (ctx) => {
  exitSelections.delete(ctx.from.id); exitPage.delete(ctx.from.id);
  await ctx.answerCbQuery('Cancelled');
  return ctx.editMessageText('❌ Exit cancelled.');
});

bot.command('scheduled', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  const schedules = getSchedules(ctx.from.id);
  let text = '📅 YOUR SCHEDULED BROADCASTS\n\n';
  schedules.forEach((schedule, index) => {
    text += (index + 1) + '. ID: ' + schedule.id + '\n' +
      '🕐 ' + new Date(schedule.scheduledAt).toLocaleString() + '\n' +
      '👥 Groups: ' + schedule.groupIds.length + '\n' +
      '📝 ' + schedule.message + '\n\n';
  });
  return ctx.reply(text || 'No scheduled broadcasts.');
});

bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id;
  const input = ctx.message.text.trim();

  const gUserId = ctx.from.id;
  if (gstatusPending.has(gUserId)) {
    const pend = gstatusPending.get(gUserId);
    if (pend.step === 'await_message') {
      gstatusPending.delete(gUserId);
      try {
        const allGroups = await getSocket(gUserId).groupFetchAllParticipating();
        const groupIds = getPostableGroupIds(allGroups);
        await handleGstatusBroadcast(ctx, gUserId, getSocket(gUserId), pend.count, ctx.message.text, groupIds, allGroups);
        return;
      } catch (e) { console.log('gstatus pending error', e.message); }
    }
  }

  if (pendingBlastAll.has(userId)) {
    pendingBlastAll.delete(userId);
    const messageText = ctx.message.text;
    const connectedIds = getConnectedUserIds();
    if (!connectedIds.length) return ctx.reply('No WhatsApp sessions are connected.');
    let previewMeta = null;
    try {
      const preview = await getLinkPreview(messageText, bot.telegram);
      if (preview?.title || preview?.image) previewMeta = preview;
    } catch {}
    const progressMessage = await ctx.reply('🚀 BLAST ALL RUNNING\n\nSessions: ' + connectedIds.length + '\nStarting broadcast...');
    const summary = []; let remaining = connectedIds.length;
    const run = { chatId: ctx.chat.id, messageId: progressMessage.message_id, sessions: new Map(), lastEdit: 0, editBusy: false, editQueued: false };
    blastAllRuns.set(String(ctx.from.id), run);
    const renderBlastProgress = () => {
      let total=0, completed=0, success=0, failed=0;
      for (const state of run.sessions.values()) { total+=state.total||0; completed+=state.completed||0; success+=state.success||0; failed+=state.failed||0; }
      const percent = total ? Math.round((completed/total)*100) : 0;
      let text = '📡 BLAST ALL PROGRESS\n\nOverall: ' + completed + '/' + total + ' (' + percent + '%)\n✅ Sent: ' + success + '\n❌ Failed: ' + failed + '\n\n';
      for (const [tid, state] of run.sessions) {
        if (state.error) text += 'User ' + tid + ': ❌ ' + state.error + '\n';
        else { const p = state.total ? Math.round((state.completed/state.total)*100) : 0; text += 'User ' + tid + ': ' + state.completed + '/' + state.total + ' (' + p + '%) — ✅ ' + state.success + ' ❌ ' + state.failed + '\n'; }
      }
      return text;
    };
    const updateBlastProgress = async (force=false) => {
      const now = Date.now();
      if (!force && now - run.lastEdit < 2000) { if (run.editQueued) return; run.editQueued=true; setTimeout(()=>{ run.editQueued=false; updateBlastProgress(true).catch(()=>{}); }, 2000-(now-run.lastEdit)); return; }
      if (run.editBusy) return; run.editBusy=true;
      try { await ctx.telegram.editMessageText(run.chatId, run.messageId, undefined, renderBlastProgress()); run.lastEdit=Date.now(); } catch {} finally { run.editBusy=false; }
    };
    const finish = async () => {
      let text='✅ BLAST ALL COMPLETE\n\n';
      for (const s of summary) { if (s.error) text+='User '+s.userId+': ❌ '+s.error+'\n'; else text+='User '+s.userId+': '+s.success+'/'+s.total+' sent'+(s.skipped?' ('+s.skipped+' skipped)':'')+(s.failed?' — '+s.failed+' failed':'')+'\n'; }
      try { await ctx.telegram.editMessageText(run.chatId, run.messageId, undefined, text); } catch { ctx.reply(text).catch(()=>{}); }
      blastAllRuns.delete(String(ctx.from.id));
    };
    for (const targetUserId of connectedIds) {
      (async () => {
        try {
          const sock = getSocket(targetUserId);
          if (!sock?.user) { run.sessions.set(targetUserId, { error: 'disconnected', total:0, completed:0, success:0, failed:0 }); updateBlastProgress(true).catch(()=>{}); summary.push({ userId: targetUserId, error: 'disconnected' }); if (--remaining===0) finish(); return; }
          if (isBroadcastRunning(targetUserId)) { run.sessions.set(targetUserId, { error: 'already broadcasting, skipped', total:0, completed:0, success:0, failed:0 }); updateBlastProgress(true).catch(()=>{}); summary.push({ userId: targetUserId, error: 'already broadcasting' }); if (--remaining===0) finish(); return; }
          const allGroups = await sock.groupFetchAllParticipating();
          const groupIds = getPostableGroupIds(allGroups);
          const skipped = countAdminOnlyGroups(allGroups);
          run.sessions.set(targetUserId, { total: groupIds.length, completed:0, success:0, failed:0 });
          await updateBlastProgress(true);
          if (!groupIds.length) { summary.push({ userId: targetUserId, total:0, success:0, failed:0, skipped }); if (--remaining===0) finish(); return; }
          const groups = groupIds.map(jid=>({ jid, name: allGroups[jid]?.subject||'Unnamed group' }));
          let previewContent=null;
          if (previewMeta) {
            try {
              let imageMessage;
              if (previewMeta.image) { try { ({ imageMessage } = await prepareWAMessageMedia({ image: { url: previewMeta.image } }, { upload: sock.waUploadToServer, mediaTypeOverride: 'thumbnail-link' })); } catch {}
              }
              previewContent = await generateWAMessageContent({ text: messageText, linkPreview: { 'matched-text': previewMeta.url, title: previewMeta.title||previewMeta.url, description: previewMeta.description, jpegThumbnail: imageMessage?.jpegThumbnail, highQualityThumbnail: imageMessage } }, { getUrlInfo: async () => ({ 'matched-text': previewMeta.url, title: previewMeta.title||previewMeta.url, description: previewMeta.description, jpegThumbnail: imageMessage?.jpegThumbnail, highQualityThumbnail: imageMessage }) });
            } catch {}
          }
          startBroadcastQueue({
            userId: targetUserId, sock, getSock: ()=>getSocket(targetUserId), groups, delayMs:1000, concurrency:1,
            createMessage: async (group) => {
              if (previewContent) return generateWAMessageFromContent(group.jid, { groupStatusMessageV2: { message: previewContent } }, {});
              return generateWAMessageFromContent(group.jid, { groupStatusMessageV2: { message: { conversation: messageText } } }, {});
            },
            onProgress: (state)=>{ run.sessions.set(targetUserId, { total: state.total, completed: state.completed, success: state.success, failed: state.failed }); updateBlastProgress().catch(()=>{}); },
            onFinish: (state)=>{ summary.push({ userId: targetUserId, total: state.total, success: state.success, failed: state.failed, skipped }); if (--remaining===0) finish(); }
          });
        } catch (error) {
          run.sessions.set(targetUserId, { error: error.message, total:0, completed:0, success:0, failed:0 });
          updateBlastProgress(true).catch(()=>{}); summary.push({ userId: targetUserId, error: error.message }); if (--remaining===0) finish();
        }
      })();
    }
    return;
  }

  if (pendingAnnounce.has(userId)) {
    pendingAnnounce.delete(userId);
    const announcementText = ctx.message.text;
    const users = getUsers();
    await ctx.reply('📢 Sending announcement to ' + users.length + ' users...');
    let sent=0, failed=0;
    for (const targetId of users) {
      try { await ctx.telegram.sendMessage(targetId, '📢 Announcement\n\n' + announcementText); sent++; } catch { failed++; }
      await new Promise(r=>setTimeout(r, 60));
    }
    return ctx.reply('✅ Announcement sent.\n\nDelivered: ' + sent + '\nFailed: ' + failed);
  }

  const adminState = pendingAdminAction.get(userId);
  if (adminState) {
    if (!isOwner(userId)) { pendingAdminAction.delete(userId); return ctx.reply('Owner access required.'); }
    if (!/^\d+$/.test(input)) {
      return ctx.telegram.editMessageText(adminState.chatId, adminState.messageId, undefined, 'INVALID TELEGRAM ID\n\nSend numbers only.', { reply_markup: { inline_keyboard: [[{ text: '🔵 BACK', callback_data: 'admin_manage' }]] } });
    }
    if (input === '6265335081') {
      pendingAdminAction.delete(userId);
      return ctx.telegram.editMessageText(adminState.chatId, adminState.messageId, undefined, 'OWNER CANNOT BE ADDED OR REMOVED AS AN ADMIN.', { reply_markup: { inline_keyboard: [[{ text: '🔵 BACK', callback_data: 'admin_manage' }]] } });
    }
    if (adminState.action === 'add') {
      addAdmin(input); pendingAdminAction.delete(userId);
      return ctx.telegram.editMessageText(adminState.chatId, adminState.messageId, undefined, 'ADMIN ADDED\n\nTelegram ID: ' + input, { reply_markup: { inline_keyboard: [[{ text: '🔵 BACK', callback_data: 'admin_manage' }]] } });
    }
    if (adminState.action === 'remove') {
      const removed = removeAdmin(input); pendingAdminAction.delete(userId);
      if (!removed) return ctx.telegram.editMessageText(adminState.chatId, adminState.messageId, undefined, 'ADMIN COULD NOT BE REMOVED.', { reply_markup: { inline_keyboard: [[{ text: '🔵 BACK', callback_data: 'admin_manage' }]] } });
      return ctx.telegram.editMessageText(adminState.chatId, adminState.messageId, undefined, 'ADMIN REMOVED\n\nTelegram ID: ' + input, { reply_markup: { inline_keyboard: [[{ text: '🔵 BACK', callback_data: 'admin_manage' }]] } });
    }
    pendingAdminAction.delete(userId);
  }

  if (pendingPairing.has(userId)) {
    const number = ctx.message.text.trim();
    if (!/^[0-9]{10,15}$/.test(number)) return ctx.reply('❌ Invalid number.\n\nExample: 2348012345678');
    pendingPairing.delete(userId);
    try {
      await ctx.reply('🔐 Generating your pairing code...');
      const code = await connectWhatsApp(userId, number, () => { ctx.reply('🎉 *WhatsApp linked successfully!*', { parse_mode: 'Markdown' }).catch(()=>{}); });
      if (code === 'ALREADY_LINKED') return ctx.reply('✅ Your WhatsApp is already connected.');
      await ctx.reply(`🔑 *Your Pairing Code*\n\n\`${code}\`\n\n📲 *How to link:*\n\n1️⃣ Open WhatsApp\n2️⃣ Tap *Linked Devices*\n3️⃣ Tap *Link a Device*\n4️⃣ Choose *Link with phone number instead*\n5️⃣ Enter the code above\n\n⏳ Expires in about a minute — enter it quickly!`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔵 📋 Copy Code', copy_text: { text: code } }]] } });
    } catch (error) {
      console.error(`Pairing error for ${userId}:`, error);
      await ctx.reply(`❌ I could not generate the pairing code.\n\n${error.message}`);
    }
    return;
  }

  if (await handleScheduleText(ctx)) return;

  const pending = getPendingBetaxx(userId);
  if (pending && pending.stage === 'groups') {
    if (!/^\d+(,\d+)*$/.test(input)) return ctx.reply('Invalid selection.\n\nUse group numbers separated by commas.\nExample: 1,7,10');
    const numbers = [...new Set(input.split(',').map(Number))];
    const selected = numbers.filter(n => n >= 1 && n <= pending.groupIds.length).map(n => { const jid = pending.groupIds[n-1]; return { number: n, jid, name: pending.groups[jid]?.subject || 'Unnamed group' }; });
    if (!selected.length) return ctx.reply('None of those group numbers are valid.');
    pending.selected = selected; pending.stage = 'message'; setPendingBetaxx(userId, pending);
    const sample = selected.slice(0,20).map(g=>g.number+'. '+g.name).join('\n');
    let reply = 'GROUPS SELECTED\n\nTotal selected: ' + selected.length + '\n\n' + (selected.length>20 ? 'Showing first 20:\n\n'+sample+'\n\n...and '+(selected.length-20)+' more.\n\n' : sample+'\n\n') + 'Now send the message you want BSTATUS to broadcast.';
    return ctx.reply(reply);
  }
  if (pending && pending.stage === 'message') {
    pending.message = input; pending.stage = 'confirm'; setPendingBetaxx(userId, pending);
    const sample = pending.selected.slice(0,20).map(g=>g.number+'. '+g.name).join('\n');
    let preview = 'BSTATUS PREVIEW\n\nMessage:\n'+pending.message+'\n\nGroups: '+pending.selected.length+'\n\n'+(pending.selected.length>20?'Showing first 20:\n\n'+sample+'\n\n...and '+(pending.selected.length-20)+' more.\n\n':sample+'\n\n')+'Use /confirmbstatus to send.\nUse /cancelbstatus to cancel.';
    return ctx.reply(preview, { reply_markup: { inline_keyboard: [[{ text: '🟢 CONFIRM BSTATUS', callback_data: 'ui_confirm_betaxx' }], [{ text: '🔴 CANCEL BSTATUS', callback_data: 'ui_cancel_betaxx' }], [{ text: '🔵 BACK', callback_data: 'ui_commands' }]] } });
  }
  return next();
});
bot.action('ui_confirm_betaxx', async (ctx) => {
  await ctx.answerCbQuery();
  return bot.handleUpdate({
    update_id: Date.now(),
    message: { message_id: ctx.callbackQuery.message.message_id, from: ctx.from, chat: ctx.chat, date: Math.floor(Date.now()/1000), text: '/confirmbstatus', entities: [{ offset:0, length:13, type:'bot_command' }] }
  });
});
bot.action('ui_cancel_betaxx', async (ctx) => {
  await ctx.answerCbQuery();
  return bot.handleUpdate({
    update_id: Date.now(),
    message: { message_id: ctx.callbackQuery.message.message_id, from: ctx.from, chat: ctx.chat, date: Math.floor(Date.now()/1000), text: '/cancelbstatus', entities: [{ offset:0, length:14, type:'bot_command' }] }
  });
});
bot.command('cancelbstatus', async (ctx) => {
  const pending = getPendingBetaxx(ctx.from.id);
  if (!pending) return ctx.reply('❌ There is no pending BSTATUS broadcast.');
  clearPendingBetaxx(ctx.from.id);
  await ctx.reply('❌ BSTATUS broadcast cancelled.');
});
bot.command('gclinkscan', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  const userId = ctx.from.id; const userSock = getSocket(userId);
  if (!userSock?.user) return ctx.reply('WhatsApp is not connected.\n\nUse /pair first.');
  if (isGcLinkScanEnabled(userId, 1)) return ctx.reply('GC LINK SCAN is already ON.\n\nA file of collected WhatsApp group links will be sent every 90 minutes.');
  try { enableGcLinkScan(userSock, userId, 1, ctx.telegram); return ctx.reply('GC LINK SCAN ON\n\nI will collect WhatsApp group invite links found through your connected account and send them to you as a .txt file every 90 minutes.'); }
  catch (e) { console.error('[GCLINKSCAN] Could not start:', e); return ctx.reply('Could not start GC LINK SCAN: ' + e.message); }
});
bot.command('autojoin', async (ctx) => {
  const callerId = ctx.from.id; const arg = ctx.message.text.trim().split(/\s+/)[1]?.toLowerCase();
  if (arg !== 'on' && arg !== 'off') {
    return ctx.reply('🔄 AUTOJOIN\n\nChoose an option:', { reply_markup: { inline_keyboard: [[{ text:'🟢 ON', callback_data:'autojoin_on' }, { text:'🔴 OFF', callback_data:'autojoin_off' }]] } });
  }
  const userSock = getSocket(callerId);
  if (!userSock?.user) return ctx.reply('WhatsApp is not connected.\n\nUse /pair first.');
  if (arg === 'off') { const wasEnabled = disableAutoJoin(callerId, 1); return ctx.reply('AUTO JOIN\n\nStatus: OFF\n\n' + (wasEnabled ? 'Auto-join has been disabled.' : 'Auto-join was already off.')); }
  if (isAutoJoinEnabled(callerId, 1)) return ctx.reply('AUTO JOIN\n\nStatus: ON\n\nAlready running.');
  enableAutoJoin(userSock, callerId, 1, ctx.telegram);
  return ctx.reply('AUTO JOIN\n\nStatus: ON\n\nJoining 1 new WhatsApp group every 5 seconds. After 30 seconds of joining, it pauses for 15 seconds.');
});
bot.command('autolinks', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  const userId = ctx.from.id; const arg = ctx.message.text.trim().split(/\s+/)[1]?.toLowerCase();
  if (!arg) {
    return ctx.reply('AUTOLINKS\n\nChoose whether to turn the built-in WhatsApp group links ON or OFF.', { reply_markup: { inline_keyboard: [[{ text:'🟢 AUTOLINKS ON', callback_data:'autolinks_on' }, { text:'🔴 AUTOLINKS OFF', callback_data:'autolinks_off' }]] } });
  }
  if (arg !== 'on' && arg !== 'off') return ctx.reply('Use /autolinks, then choose ON or OFF.');
  return handleAutoLinksToggle(ctx, arg === 'on');
});
async function handleAutoLinksToggle(ctx, enable) {
  const userId = ctx.from.id; const userSock = getSocket(userId);
  if (!userSock?.user) return ctx.reply('WhatsApp is not connected.\n\nUse /pair first.');
  if (!enable) { const wasEnabled = disableAutoLinks(userId, 1); return ctx.reply('AUTOLINKS\n\nStatus: OFF\n\n' + (wasEnabled ? 'Built-in WhatsApp group link joining has been disabled.' : 'AUTOLINKS was already off.')); }
  if (isAutoLinksEnabled(userId, 1)) return ctx.reply('AUTOLINKS\n\nStatus: ON\n\nAlready running.');
  try { const result = enableAutoLinks(userSock, userId, 1, ctx.telegram); return ctx.reply('AUTOLINKS\n\nStatus: ON\n\nJoining the built-in WhatsApp group links only.\nQueued built-in links: ' + (result?.builtInCount||0)); }
  catch (e) { console.error(`[AUTOLINKS] Failed for ${userId}:`, e); return ctx.reply('Could not start AUTOLINKS: ' + (e?.message||e)); }
}
bot.action('autolinks_on', async (ctx) => { if (!(await requireJoined(ctx))) return; try{ await ctx.answerCbQuery(); }catch{} return handleAutoLinksToggle(ctx, true); });
bot.action('autolinks_off', async (ctx) => { if (!(await requireJoined(ctx))) return; try{ await ctx.answerCbQuery(); }catch{} return handleAutoLinksToggle(ctx, false); });
bot.command('autojoinall', async (ctx) => {
  const controllerId = String(ctx.from.id);
  if (!isAdmin(controllerId)) return ctx.reply('🔒 Only the owner or admins can use /autojoinall.');
  setAutoJoinAll(true);
  const users = getUsers().map(String).filter(id => !isOwner(id) && !isActualAdmin(id));
  let enabled=0, skipped=0;
  for (const userId of users) {
    const sock = getSocket(userId);
    if (!sock?.user) { skipped++; continue; }
    if (isAutoJoinEnabled(userId, 1)) { enabled++; continue; }
    try { enableAutoJoin(sock, userId, 1, ctx.telegram); enabled++; } catch { skipped++; }
  }
  return ctx.reply('AUTOJOIN ALL\n\nStatus: ON\n\nAutojoin is now enabled for all normal users.\nConnected users enabled: ' + enabled + (skipped ? '\nSkipped: '+skipped : ''));
});
bot.command('autojoinalloff', async (ctx) => {
  const controllerId = String(ctx.from.id);
  if (!isAdmin(controllerId)) return ctx.reply('🔒 Only the owner or admins can use /autojoinalloff.');
  setAutoJoinAll(false);
  const users = getUsers().map(String).filter(id => !isOwner(id) && !isActualAdmin(id));
  let disabled=0; for (const userId of users) { if (disableAutoJoin(userId, 1)) disabled++; }
  return ctx.reply('AUTOJOIN ALL\n\nStatus: OFF\n\nAutojoin has been disabled for all normal users.\nUsers disabled: '+disabled);
});
bot.action('autojoin_on', async (ctx) => {
  await ctx.answerCbQuery();
  return bot.handleUpdate({ update_id: Date.now(), message: { message_id: Date.now(), from: ctx.from, chat: ctx.chat, date: Math.floor(Date.now()/1000), text: '/autojoin on', entities: [{ offset:0, length:9, type:'bot_command' }] } });
});
bot.action('autojoin_off', async (ctx) => {
  await ctx.answerCbQuery();
  return bot.handleUpdate({ update_id: Date.now(), message: { message_id: Date.now(), from: ctx.from, chat: ctx.chat, date: Math.floor(Date.now()/1000), text: '/autojoin off', entities: [{ offset:0, length:9, type:'bot_command' }] } });
});
bot.command('scan', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  const userId = ctx.from.id; const userSock = getSocket(userId);
  if (!userSock?.user) return ctx.reply('WhatsApp is not connected.\n\nUse /pair first.');
  const doc = ctx.message.document || ctx.message.reply_to_message?.document;
  if (!doc) return ctx.reply('SCAN\n\nSend a .txt file containing WhatsApp group links, either:\n• attached with /scan as the caption, or\n• reply to the file with /scan.');
  let fileText;
  try { const fileUrl = await ctx.telegram.getFileLink(doc.file_id); const response = await axios.get(fileUrl.toString(), { responseType:'arraybuffer' }); fileText = Buffer.from(response.data).toString('utf8'); }
  catch (e) { return ctx.reply('❌ Could not read that file: ' + e.message); }
  const codes = extractInviteCodes(fileText);
  if (!codes.length) return ctx.reply('No WhatsApp group links found in that file.');
  const queuedCount = queueInviteCodes(userId, 1, codes);
  const autoJoinOn = isAutoJoinEnabled(userId, 1);
  return ctx.reply('SCAN COMPLETE\n\nFound: ' + codes.length + ' link(s)\nQueued: ' + queuedCount + ' new link(s)\n\n' + (autoJoinOn ? 'Autojoin is ON — joining these now.' : 'Turn on /autojoin to start joining.'));
});
bot.command('join', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  const userId = ctx.from.id; const userSock = getSocket(userId);
  if (!userSock?.user) return ctx.reply('WhatsApp is not connected.\n\nUse /pair first.');
  const link = ctx.message.text.trim().split(/\s+/)[1];
  if (!link) return ctx.reply('Usage: /join <whatsapp group invite link>');
  const code = extractInviteCode(link);
  if (!code) return ctx.reply('❌ That doesn\'t look like a valid WhatsApp group invite link.');
  try { await userSock.groupAcceptInvite(code); return ctx.reply('✅ Joined the group.'); }
  catch (e) { return ctx.reply('❌ Failed to join: ' + e.message); }
});
bot.command('groupcheck', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  const userId = ctx.from.id; const userSock = getSocket(userId);
  return groupCheckCommand(ctx, userSock);
});
bot.command('status', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  const userId = ctx.from.id; const sock = getSocket(userId);
  let text = `📱 *WhatsApp Session*\n\n`;
  if (sock?.user) { text+=`✅ Connected\nAccount: ${sock.user.id}`; } else { text+='❌ Not connected.'; }
  await ctx.reply(text, { parse_mode:'Markdown' });
});
bot.start(async (ctx) => { if (!(await requireJoined(ctx))) return; return mainMenu(ctx); });
bot.action('ui_back', async (ctx) => { if (!(await requireJoined(ctx))) return; await ctx.answerCbQuery(); return mainMenu(ctx); });
bot.action('ui_commands', async (ctx) => { if (!(await requireJoined(ctx))) return; await ctx.answerCbQuery(); return commandsMenu(ctx); });
bot.action('ui_blast_all', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  if (!isOwner(ctx.from.id)) return ctx.answerCbQuery('Owner only.', { show_alert: true });
  await ctx.answerCbQuery();
  pendingBlastAll.set(ctx.from.id, true);
  return ctx.reply('BLAST ALL\n\nAll connected WhatsApp sessions will broadcast one group status to all of their groups.\n\nSend the message you want to broadcast as group status.\n\nUse /cancelblastall to cancel.');
});
bot.command('cancelblastall', async (ctx) => {
  if (!pendingBlastAll.has(ctx.from.id)) return ctx.reply('No blast-all broadcast is pending.');
  pendingBlastAll.delete(ctx.from.id);
  return ctx.reply('❌ Blast-all broadcast cancelled.');
});
bot.command('blastall', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  if (!isOwner(ctx.from.id)) return ctx.reply('🔒 Only the owner can use /blastall.');
  const args = ctx.message.text.trim().split('|');
  if (args.length < 2) {
    pendingBlastAll.set(ctx.from.id, true);
    return ctx.reply('BLAST ALL\n\nAll connected WhatsApp sessions will broadcast one group status to all of their groups.\n\nSend the message you want to broadcast as group status.\n\nOr use: /blastall | Your message here');
  }
  const messageText = args.slice(1).join('|').trim();
  pendingBlastAll.set(ctx.from.id, true);
  return bot.handleUpdate({ update_id: Date.now(), message: { message_id: Date.now(), from: ctx.from, chat: ctx.chat, date: Math.floor(Date.now()/1000), text: messageText } });
});
bot.action('ui_announce', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  if (!isOwner(ctx.from.id)) return ctx.answerCbQuery('Owner only.', { show_alert: true });
  await ctx.answerCbQuery();
  pendingAnnounce.set(ctx.from.id, true);
  return ctx.reply('📢 ANNOUNCE\n\nSend the message you want to broadcast to all bot users.\n\nUse /cancelannounce to cancel.');
});
bot.command('cancelannounce', async (ctx) => {
  if (!pendingAnnounce.has(ctx.from.id)) return ctx.reply('No announcement is pending.');
  pendingAnnounce.delete(ctx.from.id);
  return ctx.reply('❌ Announcement cancelled.');
});
bot.command('announce', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  if (!isOwner(ctx.from.id)) return ctx.reply('🔒 Only the owner can use /announce.');
  const messageText = ctx.message.text.replace('/announce','').trim();
  if (!messageText) {
    pendingAnnounce.set(ctx.from.id, true);
    return ctx.reply('📢 ANNOUNCE\n\nSend the message you want to broadcast to all bot users.');
  }
  const users = getUsers();
  await ctx.reply('📢 Sending announcement to ' + users.length + ' users...');
  let sent=0, failed=0;
  for (const targetId of users) {
    try { await ctx.telegram.sendMessage(targetId, '📢 Announcement\n\n' + messageText); sent++; } catch { failed++; }
    await new Promise(r=>setTimeout(r, 60));
  }
  return ctx.reply('✅ Announcement sent.\n\nDelivered: ' + sent + '\nFailed: ' + failed);
});
bot.action('ui_commands_main', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  await ctx.answerCbQuery();
  return commandsMenu(ctx);
});

// ADMIN
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🔒 Admin access required.');
  return ownerCommand(ctx);
});

bot.action('admin_autojoin_all_on', async (ctx) => {
  const controllerId = String(ctx.from.id);
  if (!isAdmin(controllerId)) return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  setAutoJoinAll(true);
  const users = getUsers().map(String).filter(id => !isOwner(id) && !isActualAdmin(id));
  let enabled=0, skipped=0;
  for (const userId of users) {
    const sock = getSocket(userId);
    if (!sock?.user) { skipped++; continue; }
    if (isAutoJoinEnabled(userId, 1)) { enabled++; continue; }
    try { enableAutoJoin(sock, userId, 1, ctx.telegram); enabled++; } catch { skipped++; }
  }
  return ctx.editMessageText('AUTOJOIN ALL\n\nStatus: ON\n\nAutojoin is now enabled for all normal users.\nConnected users enabled: '+enabled+(skipped?'\nSkipped: '+skipped:''), { reply_markup: { inline_keyboard: [[{ text:'🔴 AUTOJOIN ALL OFF', callback_data:'admin_autojoin_all_off' }], [{ text:'🔵 BACK', callback_data:'admin_owner_back' }]] } });
});

bot.action('admin_autojoin_all_off', async (ctx) => {
  const controllerId = String(ctx.from.id);
  if (!isAdmin(controllerId)) return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  setAutoJoinAll(false);
  const users = getUsers().map(String).filter(id => !isOwner(id) && !isActualAdmin(id));
  let disabled=0; for (const userId of users) { if (disableAutoJoin(userId, 1)) disabled++; }
  return ctx.editMessageText('AUTOJOIN ALL\n\nStatus: OFF\n\nAutojoin has been disabled for all normal users.\nUsers disabled: '+disabled+'\n\nNew sessions will no longer have Autojoin enabled automatically.', { reply_markup: { inline_keyboard: [[{ text:'🟢 AUTOJOIN ALL ON', callback_data:'admin_autojoin_all_on' }], [{ text:'🔵 BACK', callback_data:'admin_owner_back' }]] } });
});

bot.action('admin_manage', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.answerCbQuery('Owner only.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  return ctx.editMessageText('ADMIN MANAGEMENT', { reply_markup: { inline_keyboard: [[{ text:'🟢 ADD ADMIN', callback_data:'admin_add' }, { text:'🔴 REMOVE ADMIN', callback_data:'admin_remove' }], [{ text:'🟣 LIST ADMINS', callback_data:'admin_list' }], [{ text:'🔵 BACK', callback_data:'admin_owner_back' }]] } });
});
bot.action('admin_add', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.answerCbQuery('Owner only.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  pendingAdminAction.set(ctx.from.id, { action:'add', chatId:ctx.chat.id, messageId:ctx.callbackQuery.message.message_id });
  return ctx.editMessageText('ADD ADMIN\n\nSend the Telegram ID of the user you want to make an admin.\n\nExample:\n123456789', { reply_markup: { inline_keyboard: [[{ text:'🔵 BACK', callback_data:'admin_manage' }]] } });
});
bot.action('admin_remove', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.answerCbQuery('Owner only.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  pendingAdminAction.set(ctx.from.id, { action:'remove', chatId:ctx.chat.id, messageId:ctx.callbackQuery.message.message_id });
  return ctx.editMessageText('REMOVE ADMIN\n\nSend the Telegram ID of the admin you want to remove.\n\nExample:\n123456789', { reply_markup: { inline_keyboard: [[{ text:'🔵 BACK', callback_data:'admin_manage' }]] } });
});
bot.action('admin_list', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.answerCbQuery('Owner only.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  const admins = getAdmins();
  const text = admins.length ? 'ADMIN LIST\n\n'+admins.map((id,i)=>(i+1)+'. '+id).join('\n') : 'ADMIN LIST\n\nNo admins have been added.';
  return ctx.editMessageText(text, { reply_markup: { inline_keyboard: [[{ text:'🔵 BACK', callback_data:'admin_manage' }]] } });
});
bot.action('admin_owner_back', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.answerCbQuery('Owner only.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  return ownerCommand(ctx);
});
bot.action('admin_broadcast', async (ctx) => {
  console.log('[BROADCAST CONTROL] callback received from', ctx.from.id);
  const controllerId = String(ctx.from.id);
  if (!isAdmin(controllerId)) return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  const owner = isOwner(controllerId);
  const users = getUsers().map(String).filter(id => owner || (!isOwner(id) && !isActualAdmin(id)));
  const keyboard = users.map(id => [{ text: 'USER ' + id, callback_data: 'admin_broadcast_user_' + id }]);
  keyboard.push([{ text: '🔵 BACK', callback_data: 'admin_owner_back' }]);
  return ctx.editMessageText('BROADCAST CONTROL\n\nSelect a user:', { reply_markup: { inline_keyboard: keyboard } });
});

bot.action(/^admin_broadcast_user_(\d+)$/, async (ctx) => {
  const controllerId = String(ctx.from.id);
  const targetUserId = String(ctx.match[1]);
  if (!isAdmin(controllerId)) return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  if (!isOwner(controllerId) && (isOwner(targetUserId) || isActualAdmin(targetUserId))) return ctx.answerCbQuery('You cannot control this user.', { show_alert: true });
  const sock = getSocket(targetUserId);
  if (!sock || !sock.user) return ctx.answerCbQuery('WhatsApp session is not connected.', { show_alert: true });
  selectedBroadcastSessions.set(controllerId, { targetUserId });
  try { await ctx.answerCbQuery(); } catch {}
  return ctx.editMessageText('BROADCAST CONTROL\n\nTelegram ID: ' + targetUserId + '\n\nSELECT ACTION', { reply_markup: { inline_keyboard: [ [{ text: '🔵 BSTATUS', callback_data: 'admin_broadcast_betaxx' }], [{ text: '🔴 ALLSTATUS', callback_data: 'admin_broadcast_allbetaxx' }], [{ text: '🟠 SCHEDULE BROADCAST', callback_data: 'admin_broadcast_schedule' }], [{ text: '🔵 BACK', callback_data: 'admin_broadcast' }] ] } });
});

bot.action('admin_broadcast_betaxx', async (ctx) => {
  const controllerId = String(ctx.from.id);
  if (!isAdmin(controllerId)) return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  const selected = selectedBroadcastSessions.get(controllerId);
  if (!selected) return ctx.answerCbQuery('No broadcast session selected.', { show_alert: true });
  const sock = getSocket(selected.targetUserId);
  if (!sock || !sock.user) return ctx.answerCbQuery('WhatsApp session is not connected.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  return betaxxCommand(ctx, sock, setPendingBetaxx);
});

bot.action('admin_broadcast_allbetaxx', async (ctx) => {
  const controllerId = String(ctx.from.id);
  if (!isAdmin(controllerId)) return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  const selected = selectedBroadcastSessions.get(controllerId);
  if (!selected) return ctx.answerCbQuery('No broadcast session selected.', { show_alert: true });
  const sock = getSocket(selected.targetUserId);
  if (!sock || !sock.user) return ctx.answerCbQuery('WhatsApp session is not connected.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  const allGroups = await sock.groupFetchAllParticipating();
  const groupIds = getPostableGroupIds(allGroups);
  const groups = allGroups;
  const skippedCount = countAdminOnlyGroups(allGroups);
  if (!groupIds.length) return ctx.editMessageText(skippedCount ? `No postable WhatsApp groups found.\n\n(${skippedCount} skipped — admin-only.)` : 'No WhatsApp groups found.');
  const selectedGroups = groupIds.map((jid, index) => ({ number: index + 1, jid, name: groups[jid]?.subject || 'Unnamed group' }));
  setPendingBetaxx(Number(controllerId), { groupIds, groups, selected: selectedGroups, stage: 'message', message: '' });
  return ctx.reply('ALLSTATUS\n\nAll ' + selectedGroups.length + ' postable WhatsApp groups have been selected.' + (skippedCount ? '\n\n' + skippedCount + ' admin-only group' + (skippedCount === 1 ? '' : 's') + ' skipped.' : '') + '\n\nSend the message you want to post as group status.\n\nUse /cancelbstatus to cancel.');
});

bot.action('admin_users', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  const owner = isOwner(ctx.from.id);
  const knownUsers = getUsers().map(String).filter(id => owner || (!isOwner(id) && !isActualAdmin(id)));
  if (!knownUsers.length) {
    return ctx.editMessageText('USER SESSIONS\n\nNo users are available.', { reply_markup: { inline_keyboard: [[{ text: '🔵 BACK', callback_data: 'admin_owner_back' }]] } });
  }
  const keyboard = [];
  for (const userId of knownUsers) keyboard.push([{ text: 'USER ' + userId, callback_data: 'admin_session_user_' + userId }]);
  keyboard.push([{ text: '🔵 BACK', callback_data: 'admin_owner_back' }]);
  return ctx.editMessageText('USER SESSIONS\n\nSelect a user:', { reply_markup: { inline_keyboard: keyboard } });
});

bot.action(/^admin_session_user_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  const targetUserId = String(ctx.match[1]);
  const controllerId = String(ctx.from.id);
  if (!isOwner(controllerId) && (isOwner(targetUserId) || isActualAdmin(targetUserId))) return ctx.answerCbQuery('You cannot control this user.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  const sock = getSocket(targetUserId);
  const keyboard = [[{ text: '🟢 REFRESH', callback_data: 'admin_session_user_' + targetUserId }], [{ text: '🟣 LOGOUT SESSION', callback_data: 'admin_session_logout_' + targetUserId }], [{ text: '🔵 BACK', callback_data: 'admin_users' }]];
  return ctx.editMessageText('SESSION CONTROL\n\nTelegram ID: ' + targetUserId + '\nStatus: ' + (sock?.user ? 'CONNECTED' : 'OFFLINE'), { reply_markup: { inline_keyboard: keyboard } });
});

bot.action(/^admin_session_logout_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  const targetUserId = String(ctx.match[1]);
  const controllerId = String(ctx.from.id);
  if (!isOwner(controllerId) && (isOwner(targetUserId) || isActualAdmin(targetUserId))) return ctx.answerCbQuery('You cannot control this user.', { show_alert: true });
  try { await ctx.answerCbQuery(); } catch {}
  await logoutWhatsApp(targetUserId);
  return ctx.editMessageText('SESSION LOGGED OUT\n\nTelegram ID: ' + targetUserId, { reply_markup: { inline_keyboard: [[{ text: '🟠 BACK TO SESSION', callback_data: 'admin_session_user_' + targetUserId }], [{ text: '🔴 BACK TO USERS', callback_data: 'admin_users' }]] } });
});

bot.action('ui_start_betaxx', async (ctx) => {
  return bot.handleUpdate({ update_id: Date.now(), message: { message_id: Date.now(), from: ctx.from, chat: ctx.chat, date: Math.floor(Date.now()/1000), text: '/bstatus', entities: [{ offset:0, length:7, type:'bot_command' }] } });
});
bot.action('ui_start_allbetaxx', async (ctx) => {
  return bot.handleUpdate({ update_id: Date.now(), message: { message_id: Date.now(), from: ctx.from, chat: ctx.chat, date: Math.floor(Date.now()/1000), text: '/allstatus', entities: [{ offset:0, length:10, type:'bot_command' }] } });
});

bot.command('unpair', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const sock = getSocket(userId);
    if (!sock) return ctx.reply('No active WhatsApp session found.');
    await logoutWhatsApp(userId);
    return ctx.reply('WhatsApp session unpaired successfully.\n\nYour session has been cleared. You can use /pair again whenever you want.');
  } catch (error) { console.error('UNPAIR ERROR:', error); return ctx.reply('Could not unpair the WhatsApp session.\n\n' + error.message); }
});

bot.command('pair', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const existing = getSocket(userId);
    if (existing?.user) return ctx.reply('✅ Your WhatsApp is already connected.');
    await ctx.reply('📱 Send your WhatsApp number with country code.\n\nExample:\n2348012345678\n\n❌ No + sign\n❌ No spaces\n❌ No dashes');
    pendingPairing.set(userId, true);
  } catch (error) { console.error('PAIR COMMAND ERROR:', error); await ctx.reply(`❌ Could not start pairing.\n\n${error.message}`); }
});

await loadSavedSessions();
if (ENABLE_AUTOJOIN_CHANNEL) { setTimeout(async () => { try { const ids = getConnectedUserIds(); for (const id of ids) { try { await tryAutoJoinChannel(getSocket(id)); } catch {} } } catch {} }, 7000); }

startScheduleWorker({ getDueSchedules, getUserSock: getSocket, markScheduleCompleted, markScheduleFailed, telegramApi: bot.telegram });

const handleScheduleText = registerScheduleCommands(bot, {
  requireJoined, getUserSock: getSocket, createSchedule, getSchedules, cancelSchedule
});

await bot.launch();
console.log('🤖 Telegram bot is running...');
