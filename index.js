const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Configuration
const CONFIG = {
    BASE44_ENDPOINT: process.env.BASE44_ENDPOINT,
    FORUM_CHANNEL_ID: process.env.FORUM_CHANNEL_ID || '1279666725486465064',
    STAFF_CHANNEL_ID: process.env.STAFF_CHANNEL_ID || null,
    RE_ROLE_ID: process.env.RE_ROLE_ID || '1280295731449692181',
    CONFIRMATION_PHRASE: 'bean juice'
};

// Store pending inquiries (in production, use Redis or similar)
const pendingInquiries = new Map();

// Register slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('import-inquiry')
        .setDescription('Import a real estate inquiry from a forum post')
        .addStringOption(option =>
            option.setName('post-link')
                .setDescription('Link to the forum post (or run this command in the forum thread)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
];

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('Slash commands registered!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Check if user has RE Staff role
function hasRERole(member) {
    return member.roles.cache.has(CONFIG.RE_ROLE_ID);
}

// Extract thread/post data
async function extractPostData(channel) {
    const data = {
        discordId: null,
        content: '',
        images: []
    };

    // Get the thread starter message
    const starterMessage = await channel.fetchStarterMessage().catch(() => null);
    
    if (starterMessage) {
        data.discordId = starterMessage.author.id;
        data.content = starterMessage.content;
        
        // Collect images from attachments
        starterMessage.attachments.forEach(attachment => {
            if (attachment.contentType?.startsWith('image/')) {
                data.images.push(attachment.url);
            }
        });
    }

    // Also check first few messages in thread for images
    const messages = await channel.messages.fetch({ limit: 10 });
    messages.forEach(msg => {
        if (msg.author.id === data.discordId) {
            msg.attachments.forEach(attachment => {
                if (attachment.contentType?.startsWith('image/') && !data.images.includes(attachment.url)) {
                    data.images.push(attachment.url);
                }
            });
        }
    });

    return data;
}

// Send data to Base44
async function sendToBase44(inquiryData) {
    try {
        const response = await fetch(CONFIG.BASE44_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                discord_id: inquiryData.discordId,
                confirmation_phrase: inquiryData.confirmationPhrase,
                property_type: inquiryData.propertyType,
                property_size: inquiryData.propertySize,
                general_location: inquiryData.generalLocation,
                location_images: inquiryData.images
            })
        });

        const result = await response.json();
        return { success: response.ok, data: result };
    } catch (error) {
        console.error('Base44 API Error:', error);
        return { success: false, error: error.message };
    }
}

// Handle slash command
client.on('interactionCreate', async interaction => {
    // Handle the slash command
    if (interaction.isChatInputCommand() && interaction.commandName === 'import-inquiry') {
        // Check role
        if (!hasRERole(interaction.member)) {
            return interaction.reply({ 
                content: '❌ You need the Real Estate Agent role to use this command.', 
                ephemeral: true 
            });
        }

        // Determine the channel to import from
        let targetChannel = interaction.channel;
        const postLink = interaction.options.getString('post-link');

        if (postLink) {
            // Extract channel ID from link
            const match = postLink.match(/channels\/\d+\/(\d+)/);
            if (match) {
                try {
                    targetChannel = await client.channels.fetch(match[1]);
                } catch {
                    return interaction.reply({ 
                        content: '❌ Could not find that forum post. Make sure the link is correct.', 
                        ephemeral: true 
                    });
                }
            }
        }

        // Check if we're in a thread/forum post
        if (!targetChannel.isThread()) {
            return interaction.reply({ 
                content: '❌ Please run this command inside a forum post thread, or provide a link to one.', 
                ephemeral: true 
            });
        }

        // Check if it's in the RE forum
        if (targetChannel.parentId !== CONFIG.FORUM_CHANNEL_ID) {
            return interaction.reply({ 
                content: '❌ This post is not in the Real Estate forum channel.', 
                ephemeral: true 
            });
        }

        // Extract post data
        const postData = await extractPostData(targetChannel);

        if (!postData.discordId) {
            return interaction.reply({ 
                content: '❌ Could not find the original post. The thread may be empty.', 
                ephemeral: true 
            });
        }

        // Store the extracted data temporarily
        const inquiryId = `${interaction.user.id}-${Date.now()}`;
        pendingInquiries.set(inquiryId, {
            ...postData,
            threadId: targetChannel.id,
            threadName: targetChannel.name,
            staffId: interaction.user.id
        });

        // Check for confirmation phrase
        const hasConfirmation = postData.content.toLowerCase().includes(CONFIG.CONFIRMATION_PHRASE);

        // Show the property type selection first
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`propertyType:${inquiryId}`)
            .setPlaceholder('Select Property Type')
            .addOptions([
                { label: 'Native', value: 'Native', description: 'Standard in-game property' },
                { label: 'YMap', value: 'YMap', description: 'Custom map build' }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('📋 Import Real Estate Inquiry')
            .setColor(hasConfirmation ? 0x4d6443 : 0xff6b6b)
            .addFields(
                { name: 'Player Discord', value: `<@${postData.discordId}>`, inline: true },
                { name: 'Thread', value: targetChannel.name, inline: true },
                { name: 'Confirmation Phrase', value: hasConfirmation ? '✅ Found "bean juice"' : '⚠️ NOT FOUND', inline: true },
                { name: 'Images Found', value: `${postData.images.length} image(s)`, inline: true },
                { name: 'Post Content Preview', value: postData.content.substring(0, 500) || '*No text content*' }
            )
            .setFooter({ text: 'Step 1/3: Select property type below' });

        if (!hasConfirmation) {
            embed.addFields({ 
                name: '⚠️ Warning', 
                value: 'The confirmation phrase "bean juice" was not found in this post. Continue anyway?' 
            });
        }

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    // Handle property type selection
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('propertyType:')) {
        const inquiryId = interaction.customId.split(':')[1];
        const pending = pendingInquiries.get(inquiryId);

        if (!pending) {
            return interaction.reply({ content: '❌ Session expired. Please start over.', ephemeral: true });
        }

        pending.propertyType = interaction.values[0];

        // Show property size selection
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`propertySize:${inquiryId}`)
            .setPlaceholder('Select Property Size')
            .addOptions([
                { label: '25x25', value: '25x25' },
                { label: '50x50', value: '50x50' },
                { label: '100x100', value: '100x100' }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.update({ 
            content: `**Property Type:** ${pending.propertyType}\n\nStep 2/3: Select property size`,
            components: [row] 
        });
    }

    // Handle property size selection
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('propertySize:')) {
        const inquiryId = interaction.customId.split(':')[1];
        const pending = pendingInquiries.get(inquiryId);

        if (!pending) {
            return interaction.reply({ content: '❌ Session expired. Please start over.', ephemeral: true });
        }

        pending.propertySize = interaction.values[0];

        // Show modal for general location
        const modal = new ModalBuilder()
            .setCustomId(`locationModal:${inquiryId}`)
            .setTitle('Enter Location Details');

        const locationInput = new TextInputBuilder()
            .setCustomId('generalLocation')
            .setLabel('General Location')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., East of Valentine, near the river')
            .setRequired(true);

        const notesInput = new TextInputBuilder()
            .setCustomId('notes')
            .setLabel('Staff Notes (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Any additional notes about this inquiry...')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(locationInput),
            new ActionRowBuilder().addComponents(notesInput)
        );

        await interaction.showModal(modal);
    }

    // Handle modal submission
    if (interaction.isModalSubmit() && interaction.customId.startsWith('locationModal:')) {
        const inquiryId = interaction.customId.split(':')[1];
        const pending = pendingInquiries.get(inquiryId);

        if (!pending) {
            return interaction.reply({ content: '❌ Session expired. Please start over.', ephemeral: true });
        }

        pending.generalLocation = interaction.fields.getTextInputValue('generalLocation');
        pending.notes = interaction.fields.getTextInputValue('notes') || '';
        pending.confirmationPhrase = CONFIG.CONFIRMATION_PHRASE;

        // Send to Base44
        await interaction.deferReply({ ephemeral: true });

        const result = await sendToBase44(pending);

        if (result.success) {
            // Success embed
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Inquiry Imported Successfully')
                .setColor(0x4d6443)
                .addFields(
                    { name: 'Player', value: `<@${pending.discordId}>`, inline: true },
                    { name: 'Property Type', value: pending.propertyType, inline: true },
                    { name: 'Property Size', value: pending.propertySize, inline: true },
                    { name: 'Location', value: pending.generalLocation, inline: true },
                    { name: 'Images', value: `${pending.images.length} uploaded`, inline: true },
                    { name: 'Imported By', value: `<@${pending.staffId}>`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed], components: [] });

            // Send to staff channel if configured
            if (CONFIG.STAFF_CHANNEL_ID) {
                try {
                    const staffChannel = await client.channels.fetch(CONFIG.STAFF_CHANNEL_ID);
                    const notificationEmbed = new EmbedBuilder()
                        .setTitle('📥 New Real Estate Inquiry Imported')
                        .setColor(0x4d6443)
                        .addFields(
                            { name: 'Player', value: `<@${pending.discordId}>`, inline: true },
                            { name: 'Property Type', value: pending.propertyType, inline: true },
                            { name: 'Property Size', value: pending.propertySize, inline: true },
                            { name: 'Location', value: pending.generalLocation },
                            { name: 'Imported By', value: `<@${pending.staffId}>`, inline: true },
                            { name: 'Thread', value: `[View Post](https://discord.com/channels/${interaction.guildId}/${pending.threadId})`, inline: true }
                        )
                        .setTimestamp();

                    await staffChannel.send({ embeds: [notificationEmbed] });
                } catch (err) {
                    console.error('Could not send to staff channel:', err);
                }
            }

            // Clean up
            pendingInquiries.delete(inquiryId);

        } else {
            // Error embed
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Import Failed')
                .setColor(0xff6b6b)
                .setDescription(`There was an error sending data to Base44:\n\`\`\`${result.error || JSON.stringify(result.data)}\`\`\``)
                .addFields({ name: 'What to do', value: 'Check the Base44 endpoint configuration and try again.' });

            await interaction.editReply({ embeds: [errorEmbed], components: [] });
        }
    }
});

// Bot ready
client.once('ready', () => {
    console.log(`✅ Bot is online as ${client.user.tag}`);
    console.log(`📋 Forum Channel: ${CONFIG.FORUM_CHANNEL_ID}`);
    console.log(`👥 RE Role ID: ${CONFIG.RE_ROLE_ID}`);
});

// Start bot
registerCommands();
client.login(process.env.DISCORD_TOKEN);
