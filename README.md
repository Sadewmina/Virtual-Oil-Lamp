# Virtual Oil Lamp v1.0

**Dewlabs**  
Created by Sadewmina Prabashwara

## Setup guide

1. Install Node.js if it is not already installed.
2. Open PowerShell in this project folder.
3. Before the first launch, set a private administrator password:

   ```powershell
   $env:OIL_LAMP_ADMIN_PASSWORD = "your-private-password"
   ```

   If you skip this step, the initial sign-in is `admin` / `LampAdmin123!`. Change that password after signing in.
4. Start the server:

   ```powershell
   node server.js
   ```

5. On this computer, open `http://localhost:4173` in a browser. To open the site from another device on the same Wi-Fi, use this computer’s IPv4 address with port `4173` (find it with `ipconfig`). Keep the PowerShell window open while using the site.
6. Sign in as administrator, then configure the event and create or assign accounts as needed.
7. To use the live display in OBS, add a **Browser** source with URL `http://localhost:4173/display.html` and set its dimensions to match your canvas.

On first launch, the app creates local account data. Event settings are saved locally when changed. Keep the server on a trusted private network.
