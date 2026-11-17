import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext({
  user: null,
  session: null,
  loading: true,
  signInWithGitHub: async () => {},
  signInWithGoogle: async () => {},
  signInWithEmail: async () => {},
  signUpWithEmail: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  // In the desktop app the login happens in a small window and comes back here; on the web it is a normal redirect.
  const oauth = async (provider, extra = {}) => {
    if (!supabase) return { error: new Error('Supabase not configured') }
    const options = { redirectTo: window.location.origin, ...extra }
    if (window.desktop?.oauth) {
      const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { ...options, skipBrowserRedirect: true } })
      if (error || !data?.url) return { error: error || new Error('Could not start sign-in') }
      const back = await window.desktop.oauth(data.url)
      if (!back) return { error: new Error('Sign-in was closed before it finished') }
      window.location.replace(back) // the page reloads and finishes the login with the code in the address
      return { data: {}, error: null }
    }
    return supabase.auth.signInWithOAuth({ provider, options })
  }

  const signInWithGitHub = () => oauth('github', { scopes: 'repo read:user user:email' })

  const signInWithGoogle = () => oauth('google')

  // The ION app signs people in with email + password, so Qoders accepts the same account
  const signInWithEmail = async (email, password) => {
    if (!supabase) return { error: new Error('Supabase not configured') }
    return supabase.auth.signInWithPassword({ email, password })
  }

  const signUpWithEmail = async (email, password) => {
    if (!supabase) return { error: new Error('Supabase not configured') }
    return supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
  }

  const signOut = async () => {
    if (!supabase) return
    return supabase.auth.signOut()
  }

  const value = {
    user,
    session,
    loading,
    signInWithGitHub,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}