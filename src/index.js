import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // You can keep this if you have global CSS, or remove if only using Tailwind
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
