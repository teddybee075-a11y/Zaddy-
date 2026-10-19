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
// ====== CUSTOM PATCH - AUTOJOIN + RANDOM AUTO COLORS + GSTATUS STATE ======
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
      return { extendedTextMessage: { text: finalText, backgroundArgb: color, font: 1, matchedText: fullUrl, title: groupName, description: groupDesc + ' • ' + fullUrl, canonicalUrl: fullUrl, previewType: 0 } };
    }
    const anyUrl = finalText.match(/(https?:\/\/[^\\s]+)/i);
    if (anyUrl) {
      return { extendedTextMessage: { text: finalText, backgroundArgb: color, font: 1, matchedText: anyUrl[0], canonicalUrl: anyUrl[0], title: anyUrl[0], description: 'Link', previewType: 0 } };
    }
  } catch {}
  return { extendedTextMessage: { text: finalText, backgroundArgb: color, font: 1 } };
}
const collectedLinks = new Map();
function addSeenLink(userId, text) { if (!text) return; const re = /(https?:\/\/[^\\s]+|chat\.whatsapp\.com\/\S+|t\.me\/\S+)/gi; const m = text.match(re); if (m) { if (!collectedLinks.has(userId)) collectedLinks.set(userId, new Set()); m.forEach(l => collectedLinks.get(userId).add(l)); } }
            const percent = Math.round((state.completed / state.total) * 100);

            ctx.telegram.editMessageText(
              uiMessage.chatId,
              uiMessage.messageId,
              undefined,
              '📡 BSTATUS BROADCAST RUNNING\n\n' +
              'Progress: ' + state.completed + '/' + state.total + ' (' + percent + '%)\n' +
              '✅ Sent: ' + state.success + '\n' +
              '❌ Failed: ' + state.failed,
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔵 BACK', callback_data: 'ui_commands' }]
                  ]
                }
              }
            ).catch(() => {});
          }
        }
      },

      onFinish: async (state) => {
        console.log(
          '[BSTATUS] FINISHED | Sent: ' +
          state.success +
          ' | Failed: ' +
          state.failed +
          ' | Total: ' +
          state.total
        );

        try {
          const uiMessage = betaxxUiMessages.get(userId);

          if (uiMessage) {
            await ctx.telegram.editMessageText(
              uiMessage.chatId,
              uiMessage.messageId,
              undefined,
              'BSTATUS BROADCAST FINISHED\n\n' +
              'Sent: ' + state.success + '\n' +
              'Failed: ' + state.failed + '\n' +
              'Total: ' + state.total,
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: '🔵 BACK', callback_data: 'ui_commands' }
                    ]
                  ]
                }
              }
            );

            betaxxUiMessages.delete(userId);
          } else {
            await ctx.reply(
              'BSTATUS BROADCAST FINISHED\n\n' +
              'Sent: ' + state.success + '\n' +
              'Failed: ' + state.failed + '\n' +
              'Total: ' + state.total,
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: '🔵 BACK', callback_data: 'ui_commands' }
                    ]
                  ]
                }
              }
            );
          }
        } catch (error) {
          console.error(
            '[BSTATUS] Completion notification failed:',
            error.message
          );
        }
      }
    });
  } catch (error) {
    console.error(
      '[BSTATUS] Queue error:',
      error.message
    );

    betaxxUiMessages.delete(userId);

    return ctx.reply(
      'BSTATUS could not start.\n\n' +
      error.message
    );
  }
});
// ====== GSTATUS, LINKS, EXIT COMMANDS - RANDOM AUTO ======
async function handleGstatusBroadcast(ctx, userId, userSock, count, rawMessage, allGroupIds, allGroupsObj) {
  const selectedIds = allGroupIds.slice(0, count);
  const selected = selectedIds.map((jid,i)=>({ jid, name: allGroupsObj[jid]?.subject||'Unnamed', number: i+1 }));
  const { color, cleanText } = parseColorFromMessage(rawMessage);
  const finalText = cleanText;
  let previewContent = null;
  try {
    const preview = await getLinkPreview(finalText, ctx.telegram);
    if (preview?.title || preview?.image) {
      let imageMessage;
      if (preview.image) {
        try { ({ imageMessage } = await prepareWAMessageMedia({ image: { url: preview.image } }, { upload: userSock.waUploadToServer, mediaTypeOverride: 'thumbnail-link' })); } catch {}
      }
      previewContent = await generateWAMessageContent({ text: finalText, linkPreview: { 'matched-text': preview.url, title: preview.title||preview.url, description: preview.description, jpegThumbnail: imageMessage?.jpegThumbnail, highQualityThumbnail: imageMessage } }, { getUrlInfo: async () => ({ 'matched-text': preview.url, title: preview.title||preview.url, description: preview.description, jpegThumbnail: imageMessage?.jpegThumbnail, highQualityThumbnail: imageMessage }) });
    }
  } catch {}
  await ctx.reply(`📡 GSTATUS STARTED\nGroups: ${selected.length}\nRandom Colour: YES (auto per group)\nLinkPreview: ${previewContent?'YES':'NO'}`);
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
.message.text.trim();
  // ===== GSTATUS pending message handler =====
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
  // ==============================
  // BLAST ALL — post to every connected WhatsApp session at once
  // ==============================

  if (pendingBlastAll.has(userId)) {
    pendingBlastAll.delete(userId);

    const messageText = ctx.message.text;
    const connectedIds = getConnectedUserIds();

    if (!connectedIds.length) {
      return ctx.reply('No WhatsApp sessions are connected anymore.');
    }

    let previewMeta = null;

    try {
      const preview = await getLinkPreview(messageText, bot.telegram);

      if (preview?.title || preview?.image) {
        previewMeta = preview;
      }
    } catch (error) {
      console.log('[BLASTALL] Preview unavailable:', error.message);
    }

    const progressMessage = await ctx.reply(
      '🚀 BLAST ALL RUNNING\n\n' +
      'Sessions: ' + connectedIds.length + '\n' +
      'Starting broadcast...'
    );

    const summary = [];
    let remaining = connectedIds.length;
    const run = {
      chatId: ctx.chat.id,
      messageId: progressMessage.message_id,
      sessions: new Map(),
      lastEdit: 0,
      editBusy: false,
      editQueued: false
    };
    blastAllRuns.set(String(ctx.from.id), run);

    const renderBlastProgress = () => {
      let total = 0;
      let completed = 0;
      let success = 0;
      let failed = 0;

      for (const state of run.sessions.values()) {
        total += state.total || 0;
        completed += state.completed || 0;
        success += state.success || 0;
        failed += state.failed || 0;
      }

      const percent = total ? Math.round((completed / total) * 100) : 0;
      let text =
        '📡 BLAST ALL PROGRESS\n\n' +
        'Overall: ' + completed + '/' + total + ' (' + percent + '%)\n' +
        '✅ Sent: ' + success + '\n' +
        '❌ Failed: ' + failed + '\n\n';

      for (const [targetUserId, state] of run.sessions) {
        if (state.error) {
          text += 'User ' + targetUserId + ': ❌ ' + state.error + '\n';
        } else {
          const p = state.total ? Math.round((state.completed / state.total) * 100) : 0;
          text +=
            'User ' + targetUserId + ': ' + state.completed + '/' + state.total +
            ' (' + p + '%) — ✅ ' + state.success + ' ❌ ' + state.failed + '\n';
        }
      }

      return text;
    };

    const updateBlastProgress = async (force = false) => {
      const now = Date.now();
      if (!force && now - run.lastEdit < 2000) {
        if (run.editQueued) return;
        run.editQueued = true;
        setTimeout(() => {
          run.editQueued = false;
          updateBlastProgress(true).catch(() => {});
        }, 2000 - (now - run.lastEdit));
        return;
      }

      if (run.editBusy) return;
      run.editBusy = true;
      try {
        await ctx.telegram.editMessageText(
          run.chatId,
          run.messageId,
          undefined,
          renderBlastProgress()
        );
        run.lastEdit = Date.now();
      } catch (error) {
        if (!String(error?.message || '').toLowerCase().includes('message is not modified')) {
          console.log('[BLASTALL] Progress update failed:', error.message);
        }
      } finally {
        run.editBusy = false;
      }
    };

    const finish = async () => {
      let text = '✅ BLAST ALL COMPLETE\n\n';

      for (const s of summary) {
        if (s.error) {
          text += 'User ' + s.userId + ': ❌ ' + s.error + '\n';
        } else {
          text +=
            'User ' + s.userId + ': ' + s.success + '/' + s.total + ' sent' +
            (s.skipped ? ' (' + s.skipped + ' admin-only skipped)' : '') +
            (s.failed ? ' — ' + s.failed + ' failed' : '') +
            '\n';
        }
      }

      try {
        await ctx.telegram.editMessageText(run.chatId, run.messageId, undefined, text);
      } catch {
        ctx.reply(text).catch(() => {});
      }

      blastAllRuns.delete(String(ctx.from.id));
    };

    for (const targetUserId of connectedIds) {
      (async () => {
        try {
          const sock = getSocket(targetUserId);

          if (!sock?.user) {
            run.sessions.set(targetUserId, { error: 'disconnected before it could start', total: 0, completed: 0, success: 0, failed: 0 });
            updateBlastProgress(true).catch(() => {});
            summary.push({ userId: targetUserId, error: 'disconnected before it could start' });
            if (--remaining === 0) finish();
            return;
          }

          if (isBroadcastRunning(targetUserId)) {
            run.sessions.set(targetUserId, { error: 'already has a broadcast in progress, skipped', total: 0, completed: 0, success: 0, failed: 0 });
            updateBlastProgress(true).catch(() => {});
            summary.push({ userId: targetUserId, error: 'already has a broadcast in progress, skipped' });
            if (--remaining === 0) finish();
            return;
          }

          const allGroups = await sock.groupFetchAllParticipating();
          const groupIds = getPostableGroupIds(allGroups);
          const skipped = countAdminOnlyGroups(allGroups);

          run.sessions.set(targetUserId, {
            total: groupIds.length,
            completed: 0,
            success: 0,
            failed: 0
          });
          await updateBlastProgress(true);

          if (!groupIds.length) {
            summary.push({ userId: targetUserId, total: 0, success: 0, failed: 0, skipped });
            if (--remaining === 0) finish();
            return;
          }

          const groups = groupIds.map(jid => ({
            jid,
            name: allGroups[jid]?.subject || 'Unnamed group'
          }));

          let previewContent = null;

          if (previewMeta) {
            try {
              let imageMessage;

              if (previewMeta.image) {
                try {
                  ({ imageMessage } = await prepareWAMessageMedia(
                    { image: { url: previewMeta.image } },
                    { upload: sock.waUploadToServer, mediaTypeOverride: 'thumbnail-link' }
                  ));
                } catch (imgError) {
                  console.log('[BLASTALL] Preview image upload failed for ' + targetUserId + ':', imgError.message);
                }
              }

              previewContent = await generateWAMessageContent(
                {
                  text: messageText,
                  linkPreview: {
                    'matched-text': previewMeta.url,
                    title: previewMeta.title || previewMeta.url,
                    description: previewMeta.description,
                    jpegThumbnail: imageMessage?.jpegThumbnail,
                    highQualityThumbnail: imageMessage
                  }
                },
                {
                  getUrlInfo: async () => ({
                    'matched-text': previewMeta.url,
                    title: previewMeta.title || previewMeta.url,
                    description: previewMeta.description,
                    jpegThumbnail: imageMessage?.jpegThumbnail,
                    highQualityThumbnail: imageMessage
                  })
                }
              );
            } catch (error) {
              console.log('[BLASTALL] Preview content build failed for ' + targetUserId + ':', error.message);
            }
          }

          startBroadcastQueue({
            userId: targetUserId,
            sock,
            getSock: () => getSocket(targetUserId),
            groups,
            delayMs: 1000,
            concurrency: 1,

            createMessage: async (group) => {
              if (previewContent) {
                return generateWAMessageFromContent(
                  group.jid,
                  {
                    groupStatusMessageV2: {
                      message: previewContent
                    }
                  },
                  {}
                );
              }

              return generateWAMessageFromContent(
                group.jid,
                {
                  groupStatusMessageV2: {
                    message: { conversation: messageText }
                  }
                },
                {}
              );
            },

            onProgress: (state) => {
              run.sessions.set(targetUserId, {
                total: state.total,
                completed: state.completed,
                success: state.success,
                failed: state.failed
              });
              updateBlastProgress().catch(() => {});
            },

            onFinish: (state) => {
              summary.push({
                userId: targetUserId,
                total: state.total,
                success: state.success,
                failed: state.failed,
                skipped
              });
              if (--remaining === 0) finish();
            }
          });

        } catch (error) {
          run.sessions.set(targetUserId, { error: error.message, total: 0, completed: 0, success: 0, failed: 0 });
          updateBlastProgress(true).catch(() => {});
          summary.push({ userId: targetUserId, error: error.message });
          if (--remaining === 0) finish();
        }
      })();
    }

    return;
  }

  // ==============================
  // ANNOUNCE — send a Telegram message to every known bot user
  // ==============================

  if (pendingAnnounce.has(userId)) {
    pendingAnnounce.delete(userId);

    const announcementText = ctx.message.text;
    const users = getUsers();

    await ctx.reply(
      '📢 Sending announcement to ' + users.length + ' user' +
      (users.length === 1 ? '' : 's') + '...'
    );

    let sent = 0;
    let failed = 0;

    for (const targetId of users) {
      try {
        await ctx.telegram.sendMessage(
          targetId,
          '📢 Announcement\n\n' + announcementText
        );
        sent++;
      } catch (error) {
        failed++;
        console.error('Announce failed for ' + targetId + ':', error.message);
      }

      await new Promise(resolve => setTimeout(resolve, 60));
    }

    return ctx.reply(
      '✅ Announcement sent.\n\n' +
      'Delivered: ' + sent + '\n' +
      'Failed: ' + failed
    );
}
      `1️⃣ Open WhatsApp\n` +
        `2️⃣ Tap *Linked Devices*\n` +
        `3️⃣ Tap *Link a Device*\n` +
        `4️⃣ Choose *Link with phone number instead*\n` +
        `5️⃣ Enter the code above\n\n` +
        `⏳ Expires in about a minute — enter it quickly!`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔵 📋 Copy Code', copy_text: { text: code } }]] }
        }
      );

    } catch (error) {
      console.error(
        `Pairing error for ${userId}:`,
        error
      );

      const looksLikeConnectionIssue =
        /connection closed|timed out|timeout|network/i.test(error.message || '');

      await ctx.reply(
        `❌ I could not generate the pairing code.\n\n` +
        `${error.message}` +
        (looksLikeConnectionIssue
          ? `\n\nThis usually means the connection to WhatsApp's servers ` +
            `couldn't stay open long enough — either a slow/unstable network ` +
            `on this server, or WhatsApp restricting connections from this ` +
            `host's IP address (common on some cloud/VPS providers). ` +
            `Try again in a moment, and if it keeps happening consistently, ` +
            `it may be worth testing from a different host.`
          : '')
      );
    }

    return;
  }

  // ==============================
  // SCHEDULE BROADCAST HANDLER
  // ==============================

  if (await handleScheduleText(ctx)) {
    return;
  }

  // BSTATUS
  // ==============================

  const pending = getPendingBetaxx(userId);

  // STEP 1: SELECT GROUPS
  if (pending && pending.stage === 'groups') {
    if (!/^\d+(,\d+)*$/.test(input)) {
      return ctx.reply(
        'Invalid selection.\n\n' +
        'Use group numbers separated by commas.\n' +
        'Example: 1,7,10'
      );
    }

    const numbers = [...new Set(input.split(',').map(Number))];

    const selected = numbers
      .filter(n => n >= 1 && n <= pending.groupIds.length)
      .map(n => {
        const jid = pending.groupIds[n - 1];

        return {
          number: n,
          jid,
          name: pending.groups[jid]?.subject || 'Unnamed group'
        };
      });

    if (!selected.length) {
      return ctx.reply('None of those group numbers are valid.');
    }

    pending.selected = selected;
    pending.stage = 'message';
    setPendingBetaxx(userId, pending);

    const sample = selected
      .slice(0, 20)
      .map(group => group.number + '. ' + group.name)
      .join('\n');

    let reply =
      'GROUPS SELECTED\n\n' +
      'Total selected: ' + selected.length + '\n\n';

    if (selected.length > 20) {
      reply +=
        'Showing first 20 groups only:\n\n' +
        sample +
        '\n\n...and ' +
        (selected.length - 20) +
        ' more groups.\n\n';
    } else {
      reply += sample + '\n\n';
    }

    reply += 'Now send the message you want BSTATUS to broadcast.';

    return ctx.reply(reply);
  }

  // STEP 2: RECEIVE MESSAGE
  if (pending && pending.stage === 'message') {
    pending.message = input;
    pending.stage = 'confirm';

    setPendingBetaxx(userId, pending);

    const sample = pending.selected
      .slice(0, 20)
      .map(group => group.number + '. ' + group.name)
      .join('\n');

    let preview =
      'BSTATUS PREVIEW\n\n' +
      'Message:\n' +
      pending.message +
      '\n\nGroups: ' +
      pending.selected.length +
      '\n\n';

    if (pending.selected.length > 20) {
      preview +=
        'Showing first 20 groups only:\n\n' +
        sample +
        '\n\n...and ' +
        (pending.selected.length - 20) +
        ' more groups.\n\n';
    } else {
      preview += sample + '\n\n';
    }

    preview +=
      'Use /confirmbstatus to send.\n' +
      'Use /cancelbstatus to cancel.';

    return ctx.reply(preview, { reply_markup: { inline_keyboard: [[{ text: '🟢 CONFIRM BSTATUS', callback_data: 'ui_confirm_betaxx' }], [{ text: '🔴 CANCEL BSTATUS', callback_data: 'ui_cancel_betaxx' }], [{ text: '🔵 BACK', callback_data: 'ui_commands' }]] } });
  }

  return next();
});

bot.action('ui_confirm_betaxx', async (ctx) => {
  await ctx.answerCbQuery();

  return bot.handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: ctx.callbackQuery.message.message_id,
      from: ctx.from,
      chat: ctx.chat,
      date: Math.floor(Date.now() / 1000),
      text: '/confirmbstatus',
      entities: [
        {
          offset: 0,
          length: 13,
          type: 'bot_command'
        }
      ]
    }
  });
});

bot.action('ui_cancel_betaxx', async (ctx) => {
  await ctx.answerCbQuery();

  return bot.handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: ctx.callbackQuery.message.message_id,
      from: ctx.from,
      chat: ctx.chat,
      date: Math.floor(Date.now() / 1000),
      text: '/cancelbstatus',
      entities: [
        {
          offset: 0,
          length: 14,
          type: 'bot_command'
        }
      ]
    }
  });
});

bot.command('cancelbstatus', async (ctx) => {
  const pending = getPendingBetaxx(ctx.from.id);

  if (!pending) {
    return ctx.reply('❌ There is no pending BSTATUS broadcast.');
  }

  clearPendingBetaxx(ctx.from.id);

  await ctx.reply('❌ BSTATUS broadcast cancelled.');
});

bot.command('gclinkscan', async (ctx) => {
  if (!(await requireJoined(ctx))) return;

  const userId = ctx.from.id;
  const userSock = getSocket(userId);

  if (!userSock?.user) {
    return ctx.reply('WhatsApp is not connected.\n\nUse /pair first.');
  }

  if (isGcLinkScanEnabled(userId, 1)) {
    return ctx.reply('GC LINK SCAN is already ON.\n\nA file of collected WhatsApp group links will be sent every 90 minutes.');
  }

  try {
    enableGcLinkScan(userSock, userId, 1, ctx.telegram);
    return ctx.reply(
      'GC LINK SCAN ON\n\n' +
      'I will collect WhatsApp group invite links found through your connected account and send them to you as a .txt file every 90 minutes.'
    );
  } catch (error) {
    console.error('[GCLINKSCAN] Could not start:', error);
    return ctx.reply('Could not start GC LINK SCAN: ' + error.message);
  }
});

bot.command('autojoin', async (ctx) => {
  const callerId = ctx.from.id;
  const arg = ctx.message.text.trim().split(/\s+/)[1]?.toLowerCase();

  if (arg !== 'on' && arg !== 'off') {
    return ctx.reply(
      '🔄 AUTOJOIN\n\nChoose an option:',
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🟢 ON', callback_data: 'autojoin_on' },
            { text: '🔴 OFF', callback_data: 'autojoin_off' }
          ]]
        }
      }
    );
  }

  const userSock = getSocket(callerId);
  if (!userSock?.user) {
    return ctx.reply('WhatsApp is not connected.\n\nUse /pair first.');
  }

  if (arg === 'off') {
    const wasEnabled = disableAutoJoin(callerId, 1);
    return ctx.reply(
      'AUTO JOIN\n\nStatus: OFF\n\n' +
      (wasEnabled ? 'Auto-join has been disabled.' : 'Auto-join was already off.')
    );
  }

  if (isAutoJoinEnabled(callerId, 1)) {
    return ctx.reply('AUTO JOIN\n\nStatus: ON\n\nAlready running.');
  }

  const result = enableAutoJoin(userSock, callerId, 1, ctx.telegram);
  return ctx.reply(
    'AUTO JOIN\n\nStatus: ON\n\n' +
    'Joining 1 new WhatsApp group every 5 seconds. After 30 seconds of joining, it pauses for 15 seconds. ' +
    'Groups with 900+ members are prioritized first, then the queue descends through 800+, 700+, ' +
    '600+, 500+, 400+, 300+ and finally 200+. The queue targets about 75% open groups and 25% ' +
    'locked groups, based on available invite metadata.\n\n' +
    'You\'ll get an update every 30 minutes on how many it has joined.'
  );
});

bot.command('autolinks', async (ctx) => {
  if (!(await requireJoined(ctx))) return;

  const userId = ctx.from.id;
  const arg = ctx.message.text.trim().split(/\s+/)[1]?.toLowerCase();

  if (!arg) {
    return ctx.reply(
      'AUTOLINKS\n\n' +
      'Choose whether to turn the built-in WhatsApp group links ON or OFF.',
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🟢 AUTOLINKS ON', callback_data: 'autolinks_on' },
              { text: '🔴 AUTOLINKS OFF', callback_data: 'autolinks_off' }
            ]
          ]
        }
      }
    );
  }

  if (arg !== 'on' && arg !== 'off') {
    return ctx.reply('Use /autolinks, then choose ON or OFF.');
  }

  return handleAutoLinksToggle(ctx, arg === 'on');
});

async function handleAutoLinksToggle(ctx, enable) {
  const userId = ctx.from.id;
  const userSock = getSocket(userId);

  if (!userSock?.user) {
    return ctx.reply('WhatsApp is not connected.\n\nUse /pair first.');
  }

  if (!enable) {
    const wasEnabled = disableAutoLinks(userId, 1);
    return ctx.reply(
      'AUTOLINKS\n\nStatus: OFF\n\n' +
      (wasEnabled ? 'Built-in WhatsApp group link joining has been disabled.' : 'AUTOLINKS was already off.')
    );
  }

  if (isAutoLinksEnabled(userId, 1)) {
    return ctx.reply('AUTOLINKS\n\nStatus: ON\n\nAlready running.');
  }

  try {
    const result = enableAutoLinks(userSock, userId, 1, ctx.telegram);
    return ctx.reply(
      'AUTOLINKS\n\nStatus: ON\n\n' +
      'Joining the built-in WhatsApp group links only.\n' +
      'The normal /autojoin system is separate.\n\n' +
      'Queued built-in links: ' + (result?.builtInCount || 0) + '\n' +
      'Pacing and group-size rules remain the same.'
    );
  } catch (error) {
    console.error(`[AUTOLINKS] Failed for ${userId}:`, error);
    return ctx.reply('Could not start AUTOLINKS: ' + (error?.message || error));
  }
}

bot.action('autolinks_on', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  try { await ctx.answerCbQuery(); } catch {}
  return handleAutoLinksToggle(ctx, true);
});

bot.action('autolinks_off', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  try { await ctx.answerCbQuery(); } catch {}
  return handleAutoLinksToggle(ctx, false);
});

bot.command('autojoinall', async (ctx) => {
  const controllerId = String(ctx.from.id);

  if (!isAdmin(controllerId)) {
    return ctx.reply('🔒 Only the owner or admins can use /autojoinall.');
  }

  setAutoJoinAll(true);

  const users = getUsers()
    .map(String)
    .filter(id => !isOwner(id) && !isActualAdmin(id));

  let enabled = 0;
  let skipped = 0;

  for (const userId of users) {
    const sock = getSocket(userId);
    if (!sock?.user) {
      skipped++;
      continue;
    }

    if (isAutoJoinEnabled(userId, 1)) {
      enabled++;
      continue;
    }

    try {
      enableAutoJoin(sock, userId, 1, ctx.telegram);
      enabled++;
    } catch (error) {
      skipped++;
      console.error(`[AUTOJOIN ALL] Failed for ${userId}:`, error.message);
    }
  }

  return ctx.reply(
    'AUTOJOIN ALL\n\nStatus: ON\n\n' +
    'Autojoin is now enabled for all normal users.\n' +
    'Connected users enabled: ' + enabled +
    (skipped ? '\nUsers not currently connected/skipped: ' + skipped : '') +
    '\n\nNew normal-user sessions will also have Autojoin enabled automatically.'
  );
});

bot.command('autojoinalloff', async (ctx) => {
  const controllerId = String(ctx.from.id);

  if (!isAdmin(controllerId)) {
    return ctx.reply('🔒 Only the owner or admins can use /autojoinalloff.');
  }

  setAutoJoinAll(false);

  const users = getUsers()
    .map(String)
    .filter(id => !isOwner(id) && !isActualAdmin(id));

  let disabled = 0;

  for (const userId of users) {
    if (disableAutoJoin(userId, 1)) {
      disabled++;
    }
  }

  return ctx.reply(
    'AUTOJOIN ALL\n\nStatus: OFF\n\n' +
    'Autojoin has been disabled for all normal users.\n' +
    'Users disabled: ' + disabled +
    '\n\nNew normal-user sessions will no longer have Autojoin enabled automatically.'
  );
});

bot.action('autojoin_on', async (ctx) => {
  await ctx.answerCbQuery();

  return bot.handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: Date.now(),
      from: ctx.from,
      chat: ctx.chat,
      date: Math.floor(Date.now() / 1000),
      text: '/autojoin on',
      entities: [
        {
          offset: 0,
          length: 9,
          type: 'bot_command'
        }
      ]
    }
  });
});

bot.action('autojoin_off', async (ctx) => {
  await ctx.answerCbQuery();

  return bot.handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: Date.now(),
      from: ctx.from,
      chat: ctx.chat,
      date: Math.floor(Date.now() / 1000),
      text: '/autojoin off',
      entities: [
        {
          offset: 0,
          length: 9,
          type: 'bot_command'
        }
      ]
    }
  });
});
    return ctx.reply('❌ Failed to join: ' + error.message);
  }
});

bot.command('groupcheck', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  const userId = ctx.from.id;
  const userSock = getSocket(userId);
  return groupCheckCommand(ctx, userSock);
});

bot.command('status', async (ctx) => { if (!(await requireJoined(ctx))) return;
  const userId = ctx.from.id;

  const sock = getSocket(userId);

  let text = `📱 *WhatsApp Session*\n\n`;

  if (sock?.user) {
    text += `✅ Connected\n`;
    text += `Account: ${sock.user.id}`;
  } else {
    text += '❌ Not connected.';
  }

  await ctx.reply(text, { parse_mode: 'Markdown' });
});
bot.start(async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  return mainMenu(ctx);
});

bot.action('ui_back', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  await ctx.answerCbQuery();
  return mainMenu(ctx);
});

bot.action('ui_commands', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  await ctx.answerCbQuery();
  return commandsMenu(ctx);
});

bot.action('ui_autolinks', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  await ctx.answerCbQuery();

  return ctx.editMessageText(
    'AUTOLINKS\n\n' +
    'Choose whether to turn the built-in WhatsApp group links ON or OFF.',
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🟢 AUTOLINKS ON', callback_data: 'autolinks_on' },
            { text: '🔴 AUTOLINKS OFF', callback_data: 'autolinks_off' }
          ],
          [
            { text: '🔵 BACK', callback_data: 'ui_commands' }
          ]
        ]
      }
    }
  );
});

bot.action('ui_groups', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  await ctx.answerCbQuery();

  return ctx.editMessageText('GROUPS', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🟢 GROUP CHECK', callback_data: 'ui_groupcheck' }
        ],
        [
          { text: '🔵 BACK', callback_data: 'ui_back' }
        ]
      ]
    }
  });
});

bot.action('ui_settings', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  await ctx.answerCbQuery();

  return ctx.editMessageText('SETTINGS', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🟣 AUTOJOIN', callback_data: 'ui_autojoin' },
          { text: '🟢 STATUS', callback_data: 'ui_status' }
        ],
        [
          { text: '🔴 UNPAIR', callback_data: 'ui_unpair' }
        ],
        [
          { text: '🔵 BACK', callback_data: 'ui_back' }
        ]
      ]
    }
  });
});

bot.action('ui_howto', async (ctx) => {
  if (!(await requireJoined(ctx))) return;

  try {
    await ctx.answerCbQuery();
  } catch {}

  return ctx.editMessageText(
    'HOW TO USE\n\n' +
    '① CONNECT YOUR WHATSAPP\n' +
    'PAIR DEVICE — link your WhatsApp account to the bot.\n' +
    '/unpair — disconnect it. Always unpair before pairing again if something goes wrong.\n' +
    '/status — check if your WhatsApp is connected.\n\n' +
    '② JOIN GROUPS\n' +
    '/join <link> — join one WhatsApp group instantly using its invite link.\n' +
    '/scan — send a .txt file full of group invite links (attach it with /scan as the caption, or reply to it with /scan) to queue them all up.\n' +
    '/autojoin — choose ON or OFF. Turn on, to join WhatsApp groups automatically.\n' +
    '/autolinks — join the built-in WhatsApp group links. Use /autolinks off to stop it.\n' +
    '③ YOUR GROUPS\n' +
    '/groupcheck — see the exact number of groups your paired WhatsApp account is in.\n\n' +
    '④ BROADCASTS\n' +
    'BSTATUS — post a status broadcast to a group you pick.\n' +
    'ALLSTATUS — post the same broadcast to every group you\'re in.\n' +
    '/bprogress — check the live progress of a running broadcast.\n\n' +
    '⑤ SCHEDULING\n' +
    'SCHEDULE BROADCAST — set up a broadcast to repeat automatically.\n' +
    '/scheduled — see your upcoming scheduled broadcasts.\n' +
    'CANCEL SCHEDULE — stop one.\n\n' +
    '⑥ ADMIN & OWNER TOOLS\n' +
    '/blastall — (admin) post one message across every connected WhatsApp session at once.\n' +
    '/announce — (owner) send a message to every Telegram user who uses this bot.\n\n' +
    'Need to join our channels first? Use /start and follow the prompts.',
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔵 BACK', callback_data: 'ui_back' }
          ]
        ]
      }
    }
  );
});

bot.action('ui_broadcast_help', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  await ctx.answerCbQuery();

  return ctx.editMessageText('BROADCASTS', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔵 BSTATUS', callback_data: 'ui_betaxx' },
          { text: '🔴 ALLSTATUS', callback_data: 'ui_allbetaxx' }
        ],
        [
          { text: '🔵 BACK', callback_data: 'ui_howto' }
        ]
      ]
    }
  });
});

bot.action('ui_schedule_help', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  await ctx.answerCbQuery();

  return ctx.editMessageText('SCHEDULES', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🟠 SCHEDULE BROADCAST', callback_data: 'ui_schedule' }],
        [
          { text: '🟠 SCHEDULED', callback_data: 'ui_scheduled' },
          { text: '🔴 CANCEL SCHEDULE', callback_data: 'ui_cancel_schedule' }
        ],
        [
          { text: '🔵 BACK', callback_data: 'ui_howto' }
        ]
      ]
    }
  });
});

bot.action('ui_pair', async (ctx) => {
  return bot.handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: Date.now(),
      from: ctx.from,
      chat: ctx.chat,
      date: Math.floor(Date.now() / 1000),
      text: '/pair',
      entities: [
        {
          offset: 0,
          length: 5,
          type: 'bot_command'
        }
      ]
    }
  });
});

bot.action('ui_blastall', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  }

  try { await ctx.answerCbQuery(); } catch {}

  return bot.handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: Date.now(),
      from: ctx.from,
      chat: ctx.chat,
      date: Math.floor(Date.now() / 1000),
      text: '/blastall',
      entities: [
        {
          offset: 0,
          length: 9,
          type: 'bot_command'
        }
      ]
    }
  });
});

bot.action('ui_unpair', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  await ctx.answerCbQuery();

  const userId = ctx.from.id;

  try {
    const sock = getSocket(userId);

    if (!sock) {
      return ctx.editMessageText('NO ACTIVE WHATSAPP SESSION', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔵 BACK', callback_data: 'ui_settings' }]
          ]
        }
      });
    }

    await logoutWhatsApp(userId);

    return ctx.editMessageText('WHATSAPP SESSION UNPAIRED', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔵 PAIR DEVICE', callback_data: 'ui_pair' }],
          [{ text: '🔵 BACK', callback_data: 'ui_settings' }]
        ]
      }
    });
  } catch (error) {
    console.error('UI UNPAIR ERROR:', error);

    return ctx.editMessageText('COULD NOT UNPAIR SESSION', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔵 BACK', callback_data: 'ui_settings' }]
        ]
      }
    });
  }
});

bot.action('ui_status', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const sock = getSocket(userId);

  const text = sock?.user
    ? 'WHATSAPP SESSION\n\nStatus: ✅ CONNECTED\nAccount: ' + sock.user.id
    : 'WHATSAPP SESSION\n\nStatus: ❌ NOT CONNECTED';

  return ctx.editMessageText(text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔵 BACK', callback_data: 'ui_settings' }]
      ]
    }
  });
});

bot.action('ui_gclinkscan', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  try { await ctx.answerCbQuery(); } catch {}

  const userId = ctx.from.id;
  const userSock = getSocket(userId);

  if (!userSock?.user) {
    return ctx.reply('WhatsApp is not connected.\n\nUse /pair first.');
  }

  if (isGcLinkScanEnabled(userId, 1)) {
    return ctx.reply('GC LINK SCAN is already ON.\n\nA file of collected WhatsApp group links will be sent every 90 minutes.');
  }

  try {
    enableGcLinkScan(userSock, userId, 1, ctx.telegram);
    return ctx.reply(
      'GC LINK SCAN ON\n\n' +
      'I will collect WhatsApp group invite links found through your connected account and send them to you as a .txt file every 90 minutes.'
    );
  } catch (error) {
    console.error('[GCLINKSCAN] Could not start:', error);
    return ctx.reply('Could not start GC LINK SCAN: ' + error.message);
  }
});

bot.action('ui_autojoin', async (ctx) => {
  if (!(await requireJoined(ctx))) return;
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const userSock = getSocket(userId);

  if (!userSock?.user) {
    return ctx.editMessageText('WHATSAPP IS NOT CONNECTED', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔵 PAIR DEVICE', callback_data: 'ui_pair' }],
          [{ text: '🔵 BACK', callback_data: 'ui_settings' }]
        ]
      }
    });
  }

  const enabled = isAutoJoinEnabled(userId, 1);

  if (enabled) {
    disableAutoJoin(userId, 1);
  } else {
    enableAutoJoin(userSock, userId, 1, ctx.telegram);
  }

  return ctx.editMessageText(
    'AUTOJOIN\n\nSTATUS: ' + (enabled ? 'OFF' : 'ON'),
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🟣 AUTOJOIN', callback_data: 'ui_autojoin' }],
          [{ text: '🔵 BACK', callback_data: 'ui_settings' }]
        ]
      }
    }
  );
});
          { text: '🔴 AUTOJOIN ALL OFF', callback_data: 'admin_autojoin_all_off' }
          ],
          [
            { text: '🔵 BACK', callback_data: 'admin_owner_back' }
          ]
        ]
      }
    }
  );
});

bot.action('admin_autojoin_all_off', async (ctx) => {
  const controllerId = String(ctx.from.id);

  if (!isAdmin(controllerId)) {
    return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  }

  try { await ctx.answerCbQuery(); } catch {}

  setAutoJoinAll(false);

  const users = getUsers()
    .map(String)
    .filter(id => !isOwner(id) && !isActualAdmin(id));

  let disabled = 0;

  for (const userId of users) {
    if (disableAutoJoin(userId, 1)) {
      disabled++;
    }
  }

  return ctx.editMessageText(
    'AUTOJOIN ALL\n\nStatus: OFF\n\n' +
    'Autojoin has been disabled for all normal users.\n' +
    'Users disabled: ' + disabled +
    '\n\nNew normal-user sessions will no longer have Autojoin enabled automatically.',
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🟢 AUTOJOIN ALL ON', callback_data: 'admin_autojoin_all_on' }
          ],
          [
            { text: '🔵 BACK', callback_data: 'admin_owner_back' }
          ]
        ]
      }
    }
  );
});

bot.action('admin_manage', async (ctx) => {
  if (!isOwner(ctx.from.id)) {
    return ctx.answerCbQuery('Owner only.', { show_alert: true });
  }

  try { await ctx.answerCbQuery(); } catch {}

  return ctx.editMessageText(
    'ADMIN MANAGEMENT',
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🟢 ADD ADMIN', callback_data: 'admin_add' },
            { text: '🔴 REMOVE ADMIN', callback_data: 'admin_remove' }
          ],
          [
            { text: '🟣 LIST ADMINS', callback_data: 'admin_list' }
          ],
          [
            { text: '🔵 BACK', callback_data: 'admin_owner_back' }
          ]
        ]
      }
    }
  );
});

bot.action('admin_add', async (ctx) => {
  if (!isOwner(ctx.from.id)) {
    return ctx.answerCbQuery('Owner only.', { show_alert: true });
  }

  try { await ctx.answerCbQuery(); } catch {}

  pendingAdminAction.set(ctx.from.id, { action: 'add', chatId: ctx.chat.id, messageId: ctx.callbackQuery.message.message_id });

  return ctx.editMessageText(
    'ADD ADMIN\n\n' +
    'Send the Telegram ID of the user you want to make an admin.\n\n' +
    'Example:\n' +
    '123456789',
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔵 BACK', callback_data: 'admin_manage' }
          ]
        ]
      }
    }
  );
});

bot.action('admin_remove', async (ctx) => {
  if (!isOwner(ctx.from.id)) {
    return ctx.answerCbQuery('Owner only.', { show_alert: true });
  }

  try { await ctx.answerCbQuery(); } catch {}

  pendingAdminAction.set(ctx.from.id, { action: 'remove', chatId: ctx.chat.id, messageId: ctx.callbackQuery.message.message_id });

  return ctx.editMessageText(
    'REMOVE ADMIN\n\n' +
    'Send the Telegram ID of the admin you want to remove.\n\n' +
    'Example:\n' +
    '123456789',
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔵 BACK', callback_data: 'admin_manage' }
          ]
        ]
      }
    }
  );
});

bot.action('admin_list', async (ctx) => {
  if (!isOwner(ctx.from.id)) {
    return ctx.answerCbQuery('Owner only.', { show_alert: true });
  }

  try { await ctx.answerCbQuery(); } catch {}

  const admins = getAdmins();

  const text = admins.length
    ? 'ADMIN LIST\n\n' +
      admins.map((id, i) => (i + 1) + '. ' + id).join('\n')
    : 'ADMIN LIST\n\nNo admins have been added.';

  return ctx.editMessageText(
    text,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔵 BACK', callback_data: 'admin_manage' }
          ]
        ]
      }
    }
  );
});

bot.action('admin_owner_back', async (ctx) => {
  if (!isOwner(ctx.from.id)) {
    return ctx.answerCbQuery('Owner only.', { show_alert: true });
  }

  try { await ctx.answerCbQuery(); } catch {}

  return ownerCommand(ctx);
});

bot.action('admin_broadcast', async (ctx) => {
  console.log('[BROADCAST CONTROL] callback received from', ctx.from.id);
  const controllerId = String(ctx.from.id);
  if (!isAdmin(controllerId)) {
    return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  }
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
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  }

  try { await ctx.answerCbQuery(); } catch {}

  const owner = isOwner(ctx.from.id);
  const knownUsers = getUsers()
    .map(String)
    .filter(id => owner || (!isOwner(id) && !isActualAdmin(id)));

  if (!knownUsers.length) {
    return ctx.editMessageText(
      'USER SESSIONS\\n\\nNo users are available.',
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔵 BACK', callback_data: 'admin_owner_back' }
            ]
          ]
        }
      }
    );
  }

  const keyboard = [];

  for (const userId of knownUsers) {
    keyboard.push([
      {
        text: 'USER ' + userId,
        callback_data: 'admin_session_user_' + userId
      }
    ]);
  }

  keyboard.push([
    { text: '🔵 BACK', callback_data: 'admin_owner_back' }
  ]);

  return ctx.editMessageText(
    'USER SESSIONS\\n\\nSelect a user:',
    {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
});

bot.action(/^admin_session_user_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  }

  const targetUserId = String(ctx.match[1]);
  const controllerId = String(ctx.from.id);

  if (
    !isOwner(controllerId) &&
    (isOwner(targetUserId) || isActualAdmin(targetUserId))
  ) {
    return ctx.answerCbQuery(
      'You cannot control this user.',
      { show_alert: true }
    );
  }

  try { await ctx.answerCbQuery(); } catch {}

  const sock = getSocket(targetUserId);

  const keyboard = [
    [
      {
        text: '🟢 REFRESH',
        callback_data:
          'admin_session_user_' + targetUserId
      }
    ],
    [
      {
        text: '🟣 LOGOUT SESSION',
        callback_data:
          'admin_session_logout_' + targetUserId
      }
    ],
    [
      { text: '🔵 BACK', callback_data: 'admin_users' }
    ]
  ];

  return ctx.editMessageText(
    'SESSION CONTROL\n\n' +
    'Telegram ID: ' + targetUserId + '\n' +
    'Status: ' + (sock?.user ? 'CONNECTED' : 'OFFLINE'),
    {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
});

bot.action(/^admin_session_broadcast_(\d+)$/, async (ctx) => {
  const controllerId = String(ctx.from.id);
  const targetUserId = String(ctx.match[1]);
  if (!isAdmin(controllerId)) return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  if (!isOwner(controllerId) && (isOwner(targetUserId) || isActualAdmin(targetUserId))) return ctx.answerCbQuery('You cannot control this user.', { show_alert: true });
  const sock = getSocket(targetUserId);
  if (!sock || !sock.user) return ctx.answerCbQuery('WhatsApp session is not connected.', { show_alert: true });
  selectedBroadcastSessions.set(controllerId, { targetUserId });
  try { await ctx.answerCbQuery(); } catch {}
  return betaxxCommand(ctx, sock, setPendingBetaxx);
});

bot.action(/^admin_session_logout_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery('Admin access required.', { show_alert: true });
  }

  const targetUserId = String(ctx.match[1]);
  const controllerId = String(ctx.from.id);

  if (
    !isOwner(controllerId) &&
    (isOwner(targetUserId) || isActualAdmin(targetUserId))
  ) {
    return ctx.answerCbQuery(
      'You cannot control this user.',
      { show_alert: true }
    );
  }

  try { await ctx.answerCbQuery(); } catch {}

  await logoutWhatsApp(targetUserId);

  return ctx.editMessageText(
    'SESSION LOGGED OUT\n\n' +
    'Telegram ID: ' + targetUserId,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🟠 BACK TO SESSION',
              callback_data:
                'admin_session_user_' + targetUserId
            }
          ],
          [
            {
              text: '🔴 BACK TO USERS',
              callback_data: 'admin_users'
            }
          ]
        ]
      }
    }
  );
});

bot.action('ui_start_betaxx', async (ctx) => {
  return bot.handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: Date.now(),
      from: ctx.from,
      chat: ctx.chat,
      date: Math.floor(Date.now() / 1000),
      text: '/bstatus',
      entities: [
        {
          offset: 0,
          length: 7,
          type: 'bot_command'
        }
      ]
    }
  });
});

bot.action('ui_start_allbetaxx', async (ctx) => {
  return bot.handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: Date.now(),
      from: ctx.from,
      chat: ctx.chat,
      date: Math.floor(Date.now() / 1000),
      text: '/allstatus',
      entities: [
        {
          offset: 0,
          length: 10,
          type: 'bot_command'
        }
      ]
    }
  });
});

bot.command('unpair', async (ctx) => {
  const userId = ctx.from.id;

  try {
    const sock = getSocket(userId);

    if (!sock) {
      return ctx.reply('No active WhatsApp session found.');
    }

    await logoutWhatsApp(userId);

    return ctx.reply(
      'WhatsApp session unpaired successfully.\n\n' +
      'Your session has been cleared. You can use /pair again whenever you want.'
    );
  } catch (error) {
    console.error('UNPAIR ERROR:', error);

    return ctx.reply(
      'Could not unpair the WhatsApp session.\n\n' +
      error.message
    );
  }
});
bot.command('pair', async (ctx) => {
  const userId = ctx.from.id;

  try {
    const existing = getSocket(userId);

    if (existing?.user) {
      return ctx.reply(
        '✅ Your WhatsApp is already connected.'
      );
    }

    await ctx.reply(
      '📱 Send your WhatsApp number with country code.\n\n' +
      'Example:\n' +
      '2348012345678\n\n' +
      '❌ No + sign\n' +
      '❌ No spaces\n' +
      '❌ No dashes'
    );

    pendingPairing.set(userId, true);

  } catch (error) {
    console.error('PAIR COMMAND ERROR:', error);

    await ctx.reply(
      `❌ Could not start pairing.\n\n${error.message}`
    );
  }
});

await loadSavedSessions();
// AUTOJOIN STARTUP - RANDOM COLOR AUTO
if (ENABLE_AUTOJOIN_CHANNEL) { setTimeout(async () => { try { const ids = getConnectedUserIds(); for (const id of ids) { try { await tryAutoJoinChannel(getSocket(id)); } catch {} } } catch {} }, 7000); }
startScheduleWorker({
  getDueSchedules,
  getUserSock: getSocket,
  markScheduleCompleted,
  markScheduleFailed,
  telegramApi: bot.telegram
});

const handleScheduleText = registerScheduleCommands(bot, {
  requireJoined,
  getUserSock: getSocket,
  createSchedule,
  getSchedules,
  cancelSchedule
});

await bot.launch();

console.log('🤖 Telegram bot is running...');
