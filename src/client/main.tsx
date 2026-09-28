import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import OperatorAccess from './OperatorAccess';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><OperatorAccess><App /></OperatorAccess></React.StrictMode>);
