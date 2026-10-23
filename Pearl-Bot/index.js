require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');

const bot = new Telegraf(process.env.BOT_TOKEN);
const OWNER_ID = process.env.OWNER_ID;

console.log('🔮 Pearl Bot Starting...');

// ====== AUTO DELETE LINKS ======
bot.on('message', async (ctx, next) => {
  // Don't check in private (for your /bstatus etc)
  if (ctx.chat.type === 'private') return next();
  
  const text = ctx.message.text || ctx.message.caption || '';
  const hasLink = /https?:\/\/|t\.me\/|chat\.whatsapp\.com|whatsapp\.com\/channel/i.test(text);
  if (!hasLink) return next();

  try {
    // Check if Pearl is admin
    const botMember = await ctx.getChatMember(ctx.botInfo.id);
    if (botMember.status !== 'administrator') return next();
    if (!botMember.can_delete_messages) return next();

    // Allow admins to send links
    const senderMember = await ctx.getChatMember(ctx.from.id);
    if (['administrator','creator'].includes(senderMember.status)) return next();

    await ctx.deleteMessage();
    const warn = await ctx.reply(`🚫 Link deleted - ${ctx.from.first_name} links not allowed in this group`);
    setTimeout(() => {
      ctx.deleteMessage(warn.message_id).catch(()=>{});
    }, 5000);
  } catch (e) {
    console.log('Delete fail:', e.message);
  }
  return next();
});

// ====== ADMIN COMMANDS ======
bot.command('kick', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('Use /kick in a group, reply to user');
  try {
    const sender = await ctx.getChatMember(ctx.from.id);
    if (!['administrator','creator'].includes(sender.status)) return ctx.reply('Only admins can kick');

    const target = ctx.message.reply_to_message?.from;
    if (!target) return ctx.reply('Reply to the user you want to kick with /kick');

    await ctx.banChatMember(target.id);
    await ctx.unbanChatMember(target.id); // kick = ban then unban
    await ctx.reply(`👢 Kicked ${target.first_name}`);
  } catch (e) { ctx.reply('I need Ban permission: ' + e.message); }
});

bot.command('ban', async (ctx) => {
  if (ctx.chat.type === 'private') return;
  try {
    const sender = await ctx.getChatMember(ctx.from.id);
    if (!['administrator','creator'].includes(sender.status)) return;
    const target = ctx.message.reply_to_message?.from;
    if (!target) return ctx.reply('Reply to user with /ban');
    await ctx.banChatMember(target.id);
    ctx.reply(`🔨 Banned ${target.first_name}`);
  } catch(e){ ctx.reply(e.message); }
});

bot.command('unban', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ')[1];
    const userId = ctx.message.reply_to_message?.from?.id || args;
    if (!userId) return ctx.reply('Reply or /unban 123456789');
    await ctx.unbanChatMember(userId);
    ctx.reply('✅ Unbanned');
  } catch(e){ ctx.reply(e.message); }
});

// ====== BASIC COMMANDS ======
bot.start((ctx) => ctx.reply(`Hello ${ctx.from.first_name}! I'm Pearl ✨\n\nI can:\n• Delete links\n• /kick, /ban, /unban\n• /play - music\n• /game - games\n\nAdd me as admin in your group!`));

bot.command('id', (ctx) => ctx.reply(`Your ID: ${ctx.from.id}\nChat ID: ${ctx.chat.id}`));

// ====== START BOT ======
bot.launch().then(() => console.log('✅ Pearl is LIVE!')).catch(console.error);

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
