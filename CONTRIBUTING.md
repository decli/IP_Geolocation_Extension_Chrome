# Contributing

Thank you for improving the extension.

## Development workflow

1. Create a focused branch.
2. Make the smallest change that preserves the extension's monitoring semantics.
3. Add or update tests for provider failure, IPv4/IPv6 selection, and badge behavior.
4. Run:

   ```bash
   npm test
   npm run check
   npm run build
   unzip -t build/chrome.zip
   ```

5. Open a pull request explaining the root cause, user-visible behavior, and validation.

## Behavioral requirements

- A real lookup failure must remain visible as `ERR`.
- Do not replace failures with a previous country code.
- Auto mode prefers IPv4 and falls back to IPv6.
- Slow or late requests must not overwrite a newer refresh.
- Do not add broad host permissions without documenting why they are necessary.

## Releases

Version history and change notes belong on the GitHub Release page. README should describe current behavior only.

## License and attribution

Contributions are licensed under GPL-3.0. Preserve attribution to the upstream project and third-party icon/flag licenses.
