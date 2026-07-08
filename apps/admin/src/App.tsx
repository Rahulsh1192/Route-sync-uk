import { useState } from 'react';
import { getToken } from './api';
import { Login } from './Login';
import { Dashboard } from './Dashboard';

export function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  return authed ? (
    <Dashboard onLogout={() => setAuthed(false)} />
  ) : (
    <Login onLogin={() => setAuthed(true)} />
  );
}
