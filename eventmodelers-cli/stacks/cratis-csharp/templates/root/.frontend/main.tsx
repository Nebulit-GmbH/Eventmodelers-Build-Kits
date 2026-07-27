import 'reflect-metadata';
import { PrimeReactProvider } from 'primereact/api';
import ReactDOM from 'react-dom/client';
import 'primeicons/primeicons.css';
import './index.css';
import React from 'react';
import { Arc } from '@cratis/arc.react';
import App from '../App.tsx';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <PrimeReactProvider value={{ ripple: true }}>
            <Arc>
                <App />
            </Arc>
        </PrimeReactProvider>
    </React.StrictMode>
);
