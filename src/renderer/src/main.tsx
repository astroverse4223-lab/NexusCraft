import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import './styles/global.css'
import App from './App'
import { ErrorBoundary, installGlobalErrorHandlers } from './components/ErrorBoundary'

const root = document.getElementById('root')
if (!root) throw new Error('the #root element is missing from index.html')

installGlobalErrorHandlers()

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
