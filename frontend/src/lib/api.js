import axios from 'axios'

const normalizeBaseUrl = (url) => {
  if (!url) return ''
  return url.endsWith('/') ? url.slice(0, -1) : url
}

const getWindowOrigin = () => {
  if (typeof window === 'undefined') {
    return ''
  }
  return window.location.origin
}

const rawBaseUrl = import.meta.env.VITE_API_URL?.trim()
const isLocalhostBase = rawBaseUrl?.includes('localhost') || rawBaseUrl?.includes('127.0.0.1')

let apiBaseUrl = ''

if (rawBaseUrl) {
  if (isLocalhostBase && import.meta.env.PROD) {
    apiBaseUrl = ''
  } else {
    apiBaseUrl = normalizeBaseUrl(rawBaseUrl)
  }
} else {
  apiBaseUrl = ''
}

const api = axios.create({
  baseURL: apiBaseUrl || undefined,
  withCredentials: true
})

export { apiBaseUrl }
export default api
