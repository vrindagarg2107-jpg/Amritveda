## Packages
framer-motion | Page transitions and scroll-triggered animations
jwt-decode | Parsing JWT tokens for auth state
lucide-react | Standard icon set for UI

## Notes
Tailwind Config - extend fontFamily:
fontFamily: {
  sans: ["var(--font-sans)"],
  display: ["var(--font-display)"],
}
Auth token is stored in localStorage as 'token' and must be sent as 'Bearer <token>' in the Authorization header.
