import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { EventSourcingProvider } from './lib/events'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EventSourcingProvider>
      <App />
    </EventSourcingProvider>
  </StrictMode>,
)
