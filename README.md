# Payment Reconciler

A React + TypeScript app to reconcile payment schedule data with Sampath transaction logs and export an updated Excel file.

## Features

- Upload payment schedule (`.xlsx` / `.csv`)
- Upload transaction logs folder (`.msg` / `.txt`)
- Match by voucher number and append reconciliation fields
- Add totals for `Total`, `TRX.AMT`, and `NET. AMT`
- Append unmatched MSG records in a separate section
- Download processed Excel output

## Run Locally

**Prerequisites:** Node.js 18+ and `pnpm`

1. Install dependencies:
   `pnpm install`
2. Start the dev server:
   `pnpm dev`
3. Open:
   `http://localhost:3000`

## Build

- Build production bundle:
  `pnpm build`
- Preview production build:
  `pnpm preview`

## Analytics (GA4)

To enable Google Analytics 4 event tracking, set this variable in your environment:

- `VITE_GA4_MEASUREMENT_ID=G-XXXXXXXXXX`

When configured, the app tracks privacy-safe usage events (no card numbers or voucher values), such as:

- `process_started`
- `process_completed`
- `bank_parser_used`
- `file_skipped`
- `download_excel`
