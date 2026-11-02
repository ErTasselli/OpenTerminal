import {
  exchangeSchwabCode,
  schwabAuthorizationUrl,
  schwabClientId,
  schwabClientSecret,
  schwabRedirectUri,
  schwabTokenStatus,
} from "../providers/schwabAuth.js";

// Usage:
//   npm run schwab:auth -w server
//     -> prints the authorization URL to open in a browser
//   npm run schwab:auth -w server -- "https://127.0.0.1/?code=..."
//     -> exchanges the full callback URL (or just the code) and writes the token file
//
// The callback URL must exactly match the one registered on the Schwab app.

async function main(): Promise<void> {
  if (!schwabClientId() || !schwabClientSecret()) {
    console.error("Set SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET first.");
    process.exitCode = 1;
    return;
  }

  const input = process.argv.slice(2).find((arg) => arg !== "--");
  if (!input) {
    console.log("1. Add this exact URL as the app's callback URL on developer.schwab.com:");
    console.log(`   ${schwabRedirectUri()}`);
    console.log("");
    console.log("2. Open the authorization URL, approve access, then copy the full");
    console.log("   URL you were redirected to (it contains ?code=...).");
    console.log("");
    console.log(schwabAuthorizationUrl());
    console.log("");
    console.log("3. Exchange the code:");
    console.log('   npm run schwab:auth -w server -- "https://127.0.0.1/?code=..."');
    return;
  }

  const tokens = await exchangeSchwabCode(input);
  const status = schwabTokenStatus();
  console.log("Schwab authorization saved.");
  console.log(`Access token expires at: ${new Date(tokens.expires_at).toISOString()}`);
  console.log(`Refresh token stored: ${status.hasRefreshToken ? "yes" : "no"}`);
  console.log("Restart the API (or wait for the next call) to use Schwab market data.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
