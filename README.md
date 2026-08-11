# Telegram Folder Master

BUILD A REAL TELEGRAM FOLDER MERGER BOT — ONE-SHOT COMPLETE BUILD

Build this as a REAL working application, not a frontend demo.

I have no backend server, database, worker server or hosting of my own.

Use the backend, database, serverless functions, secrets management and hosting/infrastructure that are supported by this Lovable project/integrations. If I must connect an external service, create the setup wizard and tell me exactly what I need to do.

I am using Lovable with limited usage, so DO NOT waste the implementation on unnecessary features.

The ONLY purpose of this application is:

MULTIPLE TELEGRAM FOLDER LINKS → IMPORT CHATS → REMOVE DUPLICATES → REMOVE/EXCLUDE INACCESSIBLE CHATS → CREATE ONE CLEAN TELEGRAM FOLDER → RETURN THE REAL SHAREABLE LINK WHEN SUPPORTED.



1. HOW I WANT TO USE IT

I want the WEBSITE only for the initial setup and configuration.

After setup, the Telegram Bot must be my primary interface.

I should normally not need to open the website every time.

My daily workflow should be:

Open Telegram.

Send /addfolder to my bot.

Bot asks me for Telegram folder links.

I send multiple folder links, one per line.

Backend actually reads/processes those folders using my authorized Telegram user account.

It extracts all available chats.

It detects duplicates using the actual Telegram Chat/Peer ID.

It identifies inaccessible/deleted/revoked chats where Telegram provides reliable information.

It creates ONE new clean master Telegram folder containing the final unique eligible chats.

Bot sends me the processing summary and the real final shareable folder link if Telegram supports generating one.

I do NOT want to manually manage jobs from the website.



2. VERY IMPORTANT: BOT + USER ACCOUNT ARE DIFFERENT

Do NOT assume the Bot API can access my personal Telegram folders.

Use two components:

Telegram Bot

Used as my interface for commands, folder links, status updates and final results.

Authorized Telegram User Client/Session

Used to access the Telegram account/folders/chats that I authorize.

Backend

Connects both together and performs the actual processing.

Architecture:

Telegram Bot
↓
Backend
↓
Authorized Telegram User Session
↓
Telegram API
↓
Folder Processing
↓
Clean Master Folder
↓
Result sent back through Bot

The Bot Token alone must NOT be treated as sufficient for accessing my personal Telegram folders.



3. CREDENTIALS

I already have:

Telegram API ID

Telegram API Hash

Telegram Bot Token

Create secure server-side configuration/secrets for:

TELEGRAM_API_ID
TELEGRAM_API_HASH
TELEGRAM_BOT_TOKEN

DO NOT put these values in frontend JavaScript.

DO NOT hardcode them.

DO NOT log them.

DO NOT ask me to put them into source code.

Create a secure configuration screen where I can enter them.

After saving, do not display the complete secret values.



4. COMPLETE ONE-TIME SETUP WIZARD

After I log into the website, immediately show:

Telegram Setup

Step 1 — Backend

Verify backend/serverless infrastructure.

Step 2 — Database

Create/connect the required database automatically using supported Lovable infrastructure.

Step 3 — Telegram API

Enter:

API ID
API Hash

Step 4 — Telegram Bot

Enter:

Bot Token

Step 5 — Telegram User Account

Show:

Connect Telegram Account

Use Telegram’s supported user authorization flow.

If OTP or 2FA is required, let me complete it through the secure authorization flow.

DO NOT ask me to send OTP, 2FA password or Telegram session strings to the bot or Lovable chat.

Step 6 — Secure Session

Securely persist the authorized Telegram user session on the backend.

Step 7 — Bot Connection

Configure the bot webhook/updates using the supported backend mechanism.

Step 8 — Real Connection Test

Test:

Telegram API
Telegram User Session
Telegram Bot
Database
Backend

Do not show green/success status unless the real test passes.



5. FINAL SETUP SCREEN

After successful setup show:

SYSTEM READY

Telegram API       ✓
Telegram Account   ✓
Telegram Session   ✓
Telegram Bot       ✓
Database           ✓
Backend            ✓

Then show:

Your Telegram Folder Merger Bot is ready.

Also provide a simple setup guide explaining:

What was configured

Where credentials are stored

How Telegram authorization works

How to use the bot

What to do if a connection expires

How to reconnect



6. BOT COMMANDS

Keep the bot simple.

Required:

/start
/help
/addfolder
/status
/cancel

Do not build promotion, auto-join, keyword monitoring or any other bot functionality.



7. /ADDFOLDER

When I send:

/addfolder

Bot replies:

Send your Telegram folder links, one per line.

I can send:

https://t.me/addlist/XXXXX
https://t.me/addlist/YYYYY
https://t.me/addlist/ZZZZZ

The backend must actually process the links.

DO NOT simply save them and respond:

“Added to queue.”

If processing is asynchronous internally, it must actually continue and the bot must report real progress.



8. FOLDER PROCESSING

For every submitted folder:

Validate the link.

Access/process it using the authorized Telegram user client.

Retrieve all chats Telegram makes available.

Store the source folder.

Count the chats.

Continue to the next folder even if one folder fails.

Example bot update:

Processing folders…

Folder 1/10
Chats found: 47

Folder 2/10
Chats found: 63

Folder 3/10
Processing…

The counts must be REAL.

No fake progress.

No mock data.



9. PER-FOLDER RESULTS

After processing, the bot should be able to tell me:

Folder 1:
47 chats

Folder 2:
63 chats

Folder 3:
52 chats

…

Then:

Total chats found:
162

Unique chats:
104

Duplicates:
58

Inaccessible:
5

Final eligible:
99

All numbers must come from actual Telegram processing/database records.



10. CHAT IMPORT

For every available chat, store:

Telegram Chat ID / Peer ID
Title
Username if available
Chat Type
Source Folder
Access Status

Supported types:

Group
Supergroup
Channel



11. DUPLICATE DETECTION — CRITICAL

NEVER use group name as the primary duplicate identifier.

Use the actual Telegram Chat/Peer ID.

Example:

Folder A:
Crypto Group
Chat ID 12345

Folder B:
Crypto Group
Chat ID 12345

These are the SAME chat.

Keep one.

Duplicate count = 1.

But:

Crypto Group
Chat ID 12345

Crypto Group
Chat ID 67890

are DIFFERENT chats.

Keep both.

Multiple invite/folder references to the same Telegram chat must resolve to ONE canonical chat.



12. DATABASE DUPLICATE PROTECTION

Use a unique database constraint so the same Telegram chat cannot become multiple canonical records for the same user.

Logical unique identity:

user_id + telegram_chat_id

Keep source-folder relationships separately so I can know where the duplicate appeared.



13. INACCESSIBLE / DEAD CHATS

Check the status that Telegram actually makes available.

Possible classifications:

ACCESSIBLE
INACCESSIBLE
DELETED
DEACTIVATED
EXPIRED
REVOKED
NO_PERMISSION
JOIN_REQUIRED
UNKNOWN

IMPORTANT:

Do NOT guess that a group is “banned” or “frozen”.

If Telegram does not provide reliable evidence for the exact reason, use:

INACCESSIBLE

or:

UNKNOWN.

The final clean folder should exclude chats that cannot safely/technically be included.



14. FINAL CLEAN LIST

After processing all folders:

Unique + eligible + accessible chats = final list.

Duplicates and unavailable chats must NOT be included.

Keep their records for internal reporting, but do not put them in the final folder.



15. CREATE ONE MASTER FOLDER

After processing:

Create ONE NEW Telegram folder.

Do NOT modify the original Telegram folders.

The master folder should contain only:

UNIQUE + ELIGIBLE chats.

Name it automatically, for example:

Clean Master Folder - 2026-08-10

or allow the bot to ask me for a name.

Use Telegram’s actual supported folder functionality.

Do NOT simulate folder creation.

Only report success after Telegram confirms the real operation.



16. FINAL BOT RESPONSE

After successful creation, send something like:

✅ CLEAN FOLDER CREATED

Source folders: 10
Total chats found: 650
Unique chats: 420
Duplicates removed: 230
Inaccessible/excluded: 15
Final chats: 405

Master Folder:
Clean Master Folder

🔗 Shareable Link:
[REAL TELEGRAM LINK]

If Telegram does not support generating a shareable link for the exact account/operation, clearly tell me that.

NEVER generate a fake Telegram URL.



17. ORIGINAL FOLDERS

Never delete, modify or change the original source folders.

Only read/analyze them and create a new clean folder.



18. RATE LIMITS

Respect Telegram FloodWait/rate limits.

Do not bypass Telegram limits.

If Telegram requires waiting:

Pause safely.
Wait the required period.
Resume where technically possible.

Do not repeatedly hammer Telegram.

Bot should show a simple message such as:

Telegram rate limit detected.
Processing will continue automatically when allowed.



19. FAILURE HANDLING

If one folder fails, do NOT stop the complete operation.

Example:

10 folders submitted
8 successful
1 invalid
1 inaccessible

Continue with the 8 successful folders and report the failures.

Give real error reasons such as:

Invalid folder
Expired/revoked folder
No permission
Telegram authorization required
Rate limit
Telegram API error
Network error

Never show a fake successful result.



20. WEBSITE — KEEP IT MINIMAL

The website should contain only:

Login
Telegram Setup
System Status
Basic Configuration
Basic Processing History

Do NOT build:

Promotion dashboard
Auto-join system
Keyword system
CRM
Analytics
Employee panel
Complicated queue dashboard
Complex reports
Unnecessary SaaS features

The bot is the primary interface.



21. BACKEND / DATABASE / HOSTING

I have NONE of these currently.

You must implement the required backend/database/serverless architecture using the infrastructure and integrations actually supported by this Lovable project.

If an external service/account must be connected by me:

Detect it.

Create the setup screen.

Tell me exactly what it is.

Tell me exactly where to connect it.

Verify the connection.

Continue the setup.

Do NOT leave a frontend-only application.

Do NOT leave placeholder backend functions.

Do NOT say “backend required” after building only the UI.



22. SECURITY

Securely store:

Telegram API ID
Telegram API Hash
Bot Token
Telegram user session

Use server-side secrets and encrypted storage where appropriate.

Never expose secrets in frontend code.

Never log:

OTP
2FA password
Session strings
API Hash
Bot Token



23. NO FAKE FUNCTIONALITY

ABSOLUTE REQUIREMENT:

No mock Telegram groups.
No fake folder counts.
No fake duplicate counts.
No fake processing.
No fake queue success.
No fake Telegram links.
No fake connection status.

If Telegram is not connected, say:

Telegram is not connected.

If a capability is not supported by Telegram, say so clearly.

Do not invent a workaround that does not actually work.



24. NO “QUEUED” WITHOUT REAL PROCESSING

The previous implementation incorrectly showed that links were added to a queue and then failed.

Do NOT repeat this.

When I click/send folder links:

Either process them immediately,

OR, if internal background processing is technically necessary, actually start the backend job and continue processing automatically.

The bot must provide real progress and eventually a real result.

I should never have to find or manage a queue manually.



25. END-TO-END ACCEPTANCE TEST

Do not declare the project complete until this actual test works:

I log into the website.

Setup wizard appears.

I configure Telegram API ID.

I configure Telegram API Hash.

I configure Bot Token.

I authorize my Telegram user account.

System verifies the session.

Bot becomes active.

I open Telegram.

I send /addfolder.

I send two or more REAL Telegram folder links.

Bot actually reads them.

Bot tells me the real number of chats in each folder.

Bot calculates total chats.

Bot detects duplicate Telegram Chat IDs.

Bot identifies inaccessible/dead chats where possible.

Bot calculates final unique eligible chats.

Bot creates ONE real clean Telegram folder where supported.

Bot returns the real shareable link where supported.

I can open the final folder in Telegram.

If this test does not work, DO NOT say “Complete”.

Instead tell me exactly which step failed and what configuration is required.



FINAL REQUIREMENT

Build the simplest reliable version of this system.

My desired experience is:

ONE-TIME WEBSITE SETUP

↓

CONNECT TELEGRAM ACCOUNT + BOT

↓

SYSTEM READY

↓

I NEVER NEED TO OPEN THE WEBSITE FOR NORMAL USE

↓

I SEND FOLDER LINKS TO THE BOT

↓

BOT IMPORTS + DEDUPLICATES + CLEANS

↓

BOT CREATES ONE CLEAN MASTER FOLDER

↓

BOT SENDS ME THE FINAL REAL LINK

Build this exact workflow first.

Do not add unrelated functionality.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c67f1abf-f9f6-443f-b8db-3b7efbba99c6).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
