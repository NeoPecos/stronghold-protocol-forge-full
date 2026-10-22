# a5 server-ext overlay

`server-ext/ui/chat.js` and `server-ext/ui/chat.css` are the a5 lobby chat
overlay for the installed server-ext workshop pack. Copy these two files to
`workshop/server-ext/ui/` in the deployment tree before restarting the server.
The original pack provides the chat and invitation panel; this overlay adds
clickable `name#number` actions for mention and verified friend requests.
Keep the pack's other files and the engine's current chat behaviour intact.
