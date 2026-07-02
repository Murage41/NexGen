# NexGen Tailscale Access

Tailscale lets phones reach the station PC from anywhere with internet while
keeping NexGen private. Phones do not need to be on the same Wi-Fi as the
station PC once both devices are in the same Tailnet.

Official references:

- Windows install: https://tailscale.com/docs/install/windows
- Tailscale CLI: https://tailscale.com/docs/reference/tailscale-cli
- MagicDNS: https://tailscale.com/docs/features/magicdns
- ACLs: https://tailscale.com/docs/features/access-control/acls

## Station Setup

1. Install Tailscale on the station PC.
2. Sign in with the owner/admin account.
3. Rename the machine in the Tailscale admin console to something predictable,
   such as `nexgen-station`.
4. Enable MagicDNS if it is not already enabled.
5. Confirm NexGen backend is running on the station PC.
6. Run:

```cmd
cd /d D:\NexGen
npm run tailscale:status
```

The status command prints mobile URLs such as:

```text
http://nexgen-station:3001/mobile
http://100.x.y.z:3001/mobile
```

Use the MagicDNS name first. Use the `100.x.y.z` address if DNS is not working
on a particular phone.

## Phone Setup

1. Install Tailscale on the Android phone.
2. Sign in as the admin or invited employee.
3. Confirm the phone appears in the Tailscale admin console.
4. Open the NexGen Android app or browser mobile URL.
5. Log in using employee selection or staff code/PIN.

## Access Controls

Start permissive while testing, then tighten access to only NexGen port `3001`.
An example Tailnet policy shape:

```json
{
  "groups": {
    "group:nexgen-admins": ["owner@example.com"],
    "group:nexgen-employees": ["attendant@example.com"]
  },
  "tagOwners": {
    "tag:nexgen-station": ["group:nexgen-admins"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["group:nexgen-admins"],
      "dst": ["tag:nexgen-station:3001"]
    },
    {
      "action": "accept",
      "src": ["group:nexgen-employees"],
      "dst": ["tag:nexgen-station:3001"]
    }
  ]
}
```

After tagging the station PC as `tag:nexgen-station`, employee phones can reach
NexGen but not the rest of the station PC.

## Production Notes

- Do not expose port `3001` through router port forwarding.
- Keep `HOST=0.0.0.0` only when LAN or Tailnet devices must connect directly.
- Use Tailscale device approval for employee phones.
- Remove old/lost phones from the Tailscale admin console immediately.
- Use NexGen app sessions plus Tailscale device access together; Tailscale
  decides whether the device can reach the server, NexGen decides what the
  logged-in user can do.
