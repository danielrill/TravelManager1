import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  updateProfile,
} from 'firebase/auth'

export const useAuth = () => {
  const user = useState('user', () => null)
  const authReady = useState('authReady', () => false)

  const _getToken = async () => {
    if (!import.meta.client) return null
    const auth = getAuth()
    if (!auth.currentUser) return null
    return auth.currentUser.getIdToken()
  }

  const _hydrateProfile = async (fbUser) => {
    const token = await fbUser.getIdToken()
    try {
      const profile = await $fetch('/api/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      user.value = profile
    } catch {
      user.value = {
        firebase_uid: fbUser.uid,
        email: fbUser.email,
        name: fbUser.displayName ?? fbUser.email,
      }
    }
  }

  const signUpEmail = async (email, password, name) => {
    const auth = getAuth()
    const { user: fbUser } = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(fbUser, { displayName: name })
    const token = await fbUser.getIdToken(true)
    const profile = await $fetch('/api/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { name },
    })
    user.value = profile
  }

  const signInEmail = async (email, password) => {
    const auth = getAuth()
    await signInWithEmailAndPassword(auth, email, password)
    // onAuthStateChanged handles hydration
  }

  const signInGoogle = async () => {
    const auth = getAuth()
    const provider = new GoogleAuthProvider()
    const result = await signInWithPopup(auth, provider)
    // Upsert Postgres row on first Google login
    const token = await result.user.getIdToken()
    await $fetch('/api/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { name: result.user.displayName ?? result.user.email },
    })
    // onAuthStateChanged handles hydration
  }

  const setUser = (nextUser) => {
    user.value = nextUser
  }

  const initAuth = () => {
    if (!import.meta.client) return
    const auth = getAuth()
    onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        await _hydrateProfile(fbUser)
      } else {
        user.value = null
      }
      authReady.value = true
    })
  }

  const logout = async () => {
    if (!import.meta.client) return
    const auth = getAuth()
    await signOut(auth)
    user.value = null
  }

  return {
    user,
    authReady,
    setUser,
    signUpEmail,
    signInEmail,
    signInGoogle,
    initAuth,
    logout,
  }
}
