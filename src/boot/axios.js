import { defineBoot } from '#q-app/wrappers'
import axios from 'axios'

const ACCESS_TOKEN_STORAGE_KEY = 'vimel_access_token'
const AUTH_DEBUG_ENABLED = import.meta.env.DEV

function previewToken(token) {
  if (!token) return '(sin token)'
  if (token.length <= 16) return token
  return `${token.slice(0, 12)}...${token.slice(-4)}`
}

function authDebug(message, payload) {
  if (!AUTH_DEBUG_ENABLED) return
  if (payload === undefined) {
    console.debug(`[auth] ${message}`)
    return
  }
  console.debug(`[auth] ${message}`, payload)
}

function isNativeCapacitorRuntime() {
  if (typeof window === 'undefined') return false
  const capacitor = window.Capacitor
  if (!capacitor) return false
  if (typeof capacitor.isNativePlatform === 'function') {
    return capacitor.isNativePlatform()
  }
  const platform = typeof capacitor.getPlatform === 'function' ? capacitor.getPlatform() : ''
  return platform === 'ios' || platform === 'android'
}

function getStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function getStoredAccessToken() {
  const token = getStorage()?.getItem(ACCESS_TOKEN_STORAGE_KEY) || ''
  authDebug('token recuperado desde localStorage', previewToken(token))
  return token
}

function hasStoredAccessToken() {
  return !!getStoredAccessToken()
}

function storeAccessToken(token) {
  const storage = getStorage()
  if (!storage) return

  if (token) {
    storage.setItem(ACCESS_TOKEN_STORAGE_KEY, token)
    authDebug('token guardado en localStorage', previewToken(token))
    return
  }

  storage.removeItem(ACCESS_TOKEN_STORAGE_KEY)
  authDebug('token eliminado de localStorage')
}

function clearStoredAccessToken() {
  storeAccessToken('')
}

function getAccessTokenFromUrl() {
  if (typeof window === 'undefined') return ''

  try {
    return new URL(window.location.href).searchParams.get('token') || ''
  } catch {
    return ''
  }
}

function stripAccessTokenFromUrl() {
  if (typeof window === 'undefined') return

  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('token')) return
    url.searchParams.delete('token')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    // Ignorar si la URL no se puede normalizar.
  }
}

const accessTokenFromUrl = getAccessTokenFromUrl()
if (accessTokenFromUrl) {
  authDebug('token detectado en URL', previewToken(accessTokenFromUrl))
  storeAccessToken(accessTokenFromUrl)
}

// Be careful when using SSR for cross-request state pollution
// due to creating a Singleton instance here;
// If any client changes this (global) instance, it might be a
// good idea to move this instance creation inside of the
// "export default () => {}" function below (which runs individually
// for each client)
// Vite inlines VITE_* at build time. Netlify (and `.env.production`) must
// provide VITE_API_BASE_URL. A deployed host must not fall back to :8000.
function resolveApiBaseUrl() {
  const envUrl = String(import.meta.env.VITE_API_BASE_URL || '')
    .trim()
    .replace(/\/$/, '')
  if (envUrl) return envUrl

  if (typeof window === 'undefined') return ''

  const protocol = window.location.protocol || 'http:'
  const host = window.location.hostname || ''
  const isMobileShell =
    protocol === 'capacitor:' ||
    protocol === 'ionic:' ||
    isNativeCapacitorRuntime() ||
    (/android/i.test(window.navigator.userAgent || '') && host === 'localhost')
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'

  // Browser dev without an env file talks to the local API.
  // Native shells cannot reach that host; set VITE_API_BASE_URL for them.
  if (isLocalHost && !isMobileShell) {
    return `${protocol}//${host}:8000/api`
  }

  return ''
}

const inferredBaseUrl = resolveApiBaseUrl()

const api = axios.create({
  baseURL: inferredBaseUrl,
  withCredentials: true,
  timeout: 8000,
})

api.interceptors.request.use((config) => {
  const token = getStoredAccessToken()
  config.headers = config.headers || {}

  if (token) {
    if (!config.headers.Authorization && !config.headers.authorization) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }

  authDebug('headers enviados por Axios', {
    url: `${config.baseURL || ''}${config.url || ''}`,
    authorization: config.headers.Authorization || config.headers.authorization || '(sin Authorization)',
  })

  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    authDebug('respuesta de error de Axios', {
      url: `${error.config?.baseURL || ''}${error.config?.url || ''}`,
      status: error.response?.status || '(sin status)',
      detail: error.response?.data?.detail || error.message,
    })
    return Promise.reject(error)
  }
)

export default defineBoot(({ app }) => {
  // for use inside Vue files (Options API) through this.$axios and this.$api

  app.config.globalProperties.$axios = axios
  // ^ ^ ^ this will allow you to use this.$axios (for Vue Options API form)
  //       so you won't necessarily have to import axios in each vue file

  app.config.globalProperties.$api = api
  // ^ ^ ^ this will allow you to use this.$api (for Vue Options API form)
  //       so you can easily perform requests against your app's API
})

export { api, clearStoredAccessToken, getAccessTokenFromUrl, getStoredAccessToken, hasStoredAccessToken, storeAccessToken, stripAccessTokenFromUrl, previewToken }
