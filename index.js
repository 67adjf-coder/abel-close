const express = require('express');
const discordTranscripts = require('discord-html-transcripts-v2');
const { 
  Client, 
  GatewayIntentBits, 
  PermissionFlagsBits, 
  ChannelType, 
  ActionRowBuilder, 
  StringSelectMenuBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  EmbedBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  SlashCommandBuilder, 
  REST, 
  Routes 
} = require('discord.js');

// --- Keep-Alive Express Web Server ---
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
});

// --- Discord Bot Setup ---
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ] 
});

const CONFIG = {
  ADMIN_ROLE: '1547959429679292456',
  PARTNER_ROLE: '1547961683178160189',
  PARTNER_AD_CHANNEL: '1547665434587828225',
  TRANSCRIPT_CHANNEL: '1547980381645443073',
  CATEGORIES: {
    PARTNER: '1547965675165720606',
    APPLY: '1547965741054034011',
    CONCERNS: '1547965793315332187'
  },
  COLOR: 0x808080 // Gray
};

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  const commands = [
    new SlashCommandBuilder()
      .setName('ticket-setup')
      .setDescription('Setup the ticket panel')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('close')
      .setDescription('Close the ticket, save transcript, and delete channel')
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Successfully registered slash commands.');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
});

async function createTicketChannel(guild, user, categoryId) {
  return await guild.channels.create({
    name: `ticket-${user.username}`,
    type: ChannelType.GuildText,
    parent: categoryId,
    permissionOverwrites: [
      { 
        id: guild.roles.everyone.id, 
        deny: [PermissionFlagsBits.ViewChannel] 
      },
      { 
        id: user.id, 
        allow: [
          PermissionFlagsBits.ViewChannel, 
          PermissionFlagsBits.SendMessages, 
          PermissionFlagsBits.AttachFiles, 
          PermissionFlagsBits.EmbedLinks
        ] 
      },
      { 
        id: CONFIG.ADMIN_ROLE, 
        allow: [
          PermissionFlagsBits.ViewChannel, 
          PermissionFlagsBits.SendMessages, 
          PermissionFlagsBits.AttachFiles, 
          PermissionFlagsBits.EmbedLinks
        ] 
      }
    ]
  });
}

client.on('interactionCreate', async interaction => {
  // ----------------------------------------------------
  // 1. /ticket-setup Command
  // ----------------------------------------------------
  if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-setup') {
    const embed = new EmbedBuilder()
      .setTitle('Ticket Support')
      .setDescription('Select an option below to open a ticket.')
      .setColor(CONFIG.COLOR);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_select')
      .setPlaceholder('Choose ticket type...')
      .addOptions([
        { label: 'ps / net', description: 'partner with gg.weeknd', value: 'option_partner' },
        { label: 'apply', description: 'be pαrt of our teαm !', value: 'option_apply' },
        { label: 'concerns', description: 'diαl for αssistαnce !', value: 'option_concerns' }
      ]);

    await interaction.reply({ 
      embeds: [embed], 
      components: [new ActionRowBuilder().addComponents(selectMenu)] 
    });
  }

  // ----------------------------------------------------
  // 2. /close Command
  // ----------------------------------------------------
  if (interaction.isChatInputCommand() && interaction.commandName === 'close') {
    if (!interaction.channel.name.startsWith('ticket-')) {
      return interaction.reply({ content: 'This command can only be used inside a ticket channel!', ephemeral: true });
    }

    await interaction.reply({ content: 'Saving transcript and closing ticket...' });

    try {
      // Create transcript HTML file
      const transcriptFile = await discordTranscripts.createTranscript(interaction.channel, {
        limit: -1,
        filename: `${interaction.channel.name}-transcript.html`,
        saveImages: false,
        poweredBy: false
      });

      // Find user who created the ticket via channel permissions overwrite
      const ticketUserOverwrite = interaction.channel.permissionOverwrites.cache.find(
        overwrite => overwrite.type === 1 && overwrite.id !== interaction.client.user.id && overwrite.id !== CONFIG.ADMIN_ROLE
      );

      let ticketUser = null;
      if (ticketUserOverwrite) {
        ticketUser = await interaction.guild.members.fetch(ticketUserOverwrite.id).catch(() => null);
      }

      const logEmbed = new EmbedBuilder()
        .setTitle('Ticket Closed')
        .addFields(
          { name: 'Ticket Channel', value: `${interaction.channel.name}`, inline: true },
          { name: 'Closed By', value: `${interaction.user.tag}`, inline: true },
          { name: 'Ticket Creator', value: ticketUser ? `<@${ticketUser.id}>` : 'Unknown User', inline: true }
        )
        .setColor(CONFIG.COLOR)
        .setTimestamp();

      // 1. Send Transcript to User DM
      if (ticketUser) {
        try {
          await ticketUser.send({
            content: `Here is the transcript for your closed ticket: **${interaction.channel.name}**`,
            embeds: [logEmbed],
            files: [transcriptFile]
          });
        } catch (err) {
          console.log(`Could not send DM to user ${ticketUser.user.tag}: ${err.message}`);
        }
      }

      // 2. Send Transcript to the Log Channel
      const logChannel = await interaction.guild.channels.fetch(CONFIG.TRANSCRIPT_CHANNEL).catch(() => null);
      if (logChannel) {
        await logChannel.send({
          embeds: [logEmbed],
          files: [transcriptFile]
        });
      }

      // 3. Delete channel after 5 seconds
      setTimeout(() => {
        interaction.channel.delete().catch(console.error);
      }, 5000);

    } catch (error) {
      console.error('Error closing ticket:', error);
      await interaction.followUp({ content: 'An error occurred while generating transcript!', ephemeral: true });
    }
  }

  // ----------------------------------------------------
  // 3. Select Menu Handling
  // ----------------------------------------------------
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
    const val = interaction.values[0];
    await interaction.reply({ 
      content: 'give us 5 seconds to create your ticket! <a:loading_bg:953333008130244678>', 
      ephemeral: true 
    });

    let catId = CONFIG.CATEGORIES.PARTNER;
    if (val === 'option_apply') catId = CONFIG.CATEGORIES.APPLY;
    if (val === 'option_concerns') catId = CONFIG.CATEGORIES.CONCERNS;

    const channel = await createTicketChannel(interaction.guild, interaction.user, catId);

    if (val === 'option_partner') {
      const embed = new EmbedBuilder()
        .setDescription("_ _\n            tickette booth . . .\n> reαdy to be pαrtners with **gg.weeknd?**\n> click on the respective buttons to continue!\n_ _")
        .setColor(CONFIG.COLOR);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_partner_reqs').setLabel('pαrtner').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_network_reqs').setLabel('network').setStyle(ButtonStyle.Secondary)
      );
      await channel.send({ embeds: [embed], components: [row] });
    } else {
      const embed = new EmbedBuilder()
        .setDescription("_ _\n     thαnk you for contαcting us !\n     kindly  wαit  for our stαffs  to\n     αssist  you  with  this  mαtter\n_ _\n> use .ping after 2 hrs w no response")
        .setColor(CONFIG.COLOR);
      await channel.send({ embeds: [embed] });
    }
  }

  // ----------------------------------------------------
  // 4. Button Interactions
  // ----------------------------------------------------
  if (interaction.isButton()) {
    if (interaction.customId === 'btn_partner_reqs') {
      const embed = new EmbedBuilder()
        .setDescription("_ _\n   ` pαrtner reqs ; `\n_ _\n                **for the community**\n> <:w_dot:1534807724947406909>sfw, ssfw, ntox, stox only \n> <:w_dot:1534807724947406909> must follow discord tos\n> <:w_dot:1534807724947406909>must not engαge in αny,\n       nuking, doxxing, or rαids\n_ _\n                **for the retαils**\n> <:w_dot:1534807724947406909>must hαve α  vouch  channel\n> <:w_dot:1534807724947406909>at leαst 30 dαys old / serving\n> <:w_dot:1534807724947406909>must show rules & legitimacy\n_ _ \n~~                                                                                ~~\n> <:w_dot:1534807724947406909> one - two rep(s) per sv, must\n     must not hαve  <@&1547961683178160189> role \n> <:w_dot:1534807724947406909> remove hidden pings. thank u!\n_ _")
        .setColor(CONFIG.COLOR);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('modal_partner').setLabel('reqs αre met !').setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({ embeds: [embed], components: [row] });
    }

    if (interaction.customId === 'btn_network_reqs') {
      const embed = new EmbedBuilder()
        .setDescription("_ _\n   ` network reqs ; `\n_ _\n                **for the community**\n> <:w_dot:1534807724947406909>sfw, ssfw, ntox, stox only \n> <:w_dot:1534807724947406909> must follow discord tos\n> <:w_dot:1534807724947406909>must not engαge in αny,\n       nuking, doxxing, or rαids\n_ _\n~~                                                                                ~~\n_ _")
        .setColor(CONFIG.COLOR);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('modal_network').setLabel('reqs αre met !').setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({ embeds: [embed], components: [row] });
    }

    if (interaction.customId === 'modal_partner') {
      const modal = new ModalBuilder().setCustomId('form_partner').setTitle('Partner Application');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('ad').setLabel('Server Ad (No @everyone/@here)').setStyle(TextInputStyle.Paragraph).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('rep2').setLabel('2nd Rep Username (if sub 200 members)').setStyle(TextInputStyle.Short).setRequired(false)
        )
      );
      await interaction.showModal(modal);
    }

    if (interaction.customId === 'modal_network') {
      const modal = new ModalBuilder().setCustomId('form_network').setTitle('Network Application');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('link').setLabel('Server Link').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
    }
  }

  // ----------------------------------------------------
  // 5. Modal Submissions
  // ----------------------------------------------------
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'form_partner') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const adText = interaction.fields.getTextInputValue('ad');
        if (adText.includes('@everyone') || adText.includes('@here')) {
          return await interaction.editReply({ 
            content: 'Invalid server ad! Hidden or explicit `@everyone` / `@here` pings are not allowed.' 
          });
        }

        const adChannel = await interaction.guild.channels.fetch(CONFIG.PARTNER_AD_CHANNEL).catch(() => null);
        if (!adChannel) {
          return await interaction.editReply({ content: 'Error: Partner ad channel not found.' });
        }

        await adChannel.send(adText);

        const member = await interaction.guild.members.fetch(interaction.user.id);
        await member.roles.add(CONFIG.PARTNER_ROLE);

        await interaction.editReply({ content: 'Server ad successfully submitted and role granted!' });
      } catch (error) {
        console.error('Modal error:', error);
        await interaction.editReply({ 
          content: 'Failed to process application. Check bot permissions and role hierarchy!' 
        });
      }
    }

    if (interaction.customId === 'form_network') {
      await interaction.reply({ 
        content: `<@&${CONFIG.ADMIN_ROLE}> check for network.\nkindly wαit pαtiently. thank you sm !` 
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
