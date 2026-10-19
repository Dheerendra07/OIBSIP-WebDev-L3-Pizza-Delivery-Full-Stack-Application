# Pizza House — Full-Stack Pizza Delivery

React/Vite frontend + Express/Mongoose API for custom pizza orders, inventory management, email verification, admin controls, Razorpay **test mode**, and order tracking.

## Start here
Read `PROJECT_STATUS.md`, `docs/ARCHITECTURE.md`, and `CONTRIBUTING.md` before contributing. The status file separates verified checks from integrations not yet tested.

## Local setup
1. Copy `.env.example` to `server/.env` and `client/.env.example` to `client/.env`.
2. Configure MongoDB with transaction support, SMTP, a strong JWT secret, and Razorpay test keys only.
3. Run `npm run install:all`.
4. Run `npm run seed:inventory`, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `server/.env`, then run `npm run seed:admin`.
5. Run `npm run dev`; run automated tests with `npm test`.

Never commit real `.env` files or live payment credentials. The build command was intentionally skipped per owner request; do not claim it passed.
