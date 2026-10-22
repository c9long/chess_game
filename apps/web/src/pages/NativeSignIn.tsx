import { AuthCard } from '../components/AuthCard.tsx'

/**
 * Sign-in inside the mobile apps (docs/MOBILE.md §2). The web forms can't work there: their
 * cookies don't reach the API from the app's origin, Turnstile only accepts our web hostname,
 * and passkeys need the real web origin. The apps will sign in through the website's device
 * flow instead (client id `game-mobile-client`) and keep the bearer token it returns. Until
 * that screen exists, the sign-in, sign-up and guest routes show this in a native build.
 */
export function NativeSignIn() {
  return (
    <AuthCard
      title="Sign in"
      subtitle="Signing in from the app isn’t available yet in this test build."
    >
      <p className="text-body text-muted" data-testid="native-sign-in">
        Soon you’ll sign in, create an account or play as a guest on our website, then return here
        signed in.
      </p>
    </AuthCard>
  )
}
