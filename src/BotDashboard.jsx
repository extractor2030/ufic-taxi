import React, { useState, useEffect, useRef } from 'react';
import { Terminal, X, ChevronRight, AlertCircle, Check } from 'lucide-react';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  serverTimestamp, 
  setDoc,
  doc 
} from "firebase/firestore";

// Вспомогательная функция для путей (как в App.jsx), чтобы уведомления доходили до пользователей
const getCollection = (db, appId, collectionName) => {
  return collection(db, 'artifacts', appId, 'public', 'data', collectionName);
};

const getDocument = (db, appId, collectionName, docId) => {
  return doc(db, 'artifacts', appId, 'public', 'data', collectionName, docId);
};

const BotDashboard = ({ onClose, db, currentAdmin, appId = 'ufic-taxi' }) => {
  const [logs, setLogs] = useState([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  const mountTimeRef = useRef(Date.now());

  // Логирование в окно терминала
  const addLog = (type, text) => {
    const safeText = typeof text === 'string' ? text : JSON.stringify(text);
    setLogs(prev => [...prev, { 
      id: Date.now() + Math.random(), 
      type, 
      text: safeText, 
      time: new Date().toLocaleTimeString() 
    }]);
  };

  // Инициализация и прослушка событий
  useEffect(() => {
    addLog('system', 'Initializing UFIC Bot Terminal v2.2 (External)...');
    
    if (!currentAdmin) {
        addLog('error', 'Auth Error: Admin user not identified.');
        return;
    }

    addLog('system', `Connected as ADMIN: ${currentAdmin.name || 'Unknown'}`);
    addLog('info', 'Type /help for available commands.');
    
    if (!db) {
        addLog('error', 'Database connection failed.');
        return;
    }

    // Слушаем новые broadcast сообщения, чтобы видеть, что мы отправили
    const q = query(getCollection(db, appId, "broadcast_messages"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                // Безопасное получение даты
                const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
                
                // Показываем только те, что пришли после открытия окна
                if (createdAt.getTime() > mountTimeRef.current) {
                    addLog('event', `[BROADCAST] ${data.message ? data.message.substring(0, 50) : '...'}...`);
                }
            }
        });
    });

    return () => unsubscribe();
  }, [db, appId, currentAdmin]);

  // Автопрокрутка вниз
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const executeCommand = async (cmdRaw) => {
    const cmd = cmdRaw.trim();
    if (!cmd) return;

    addLog('input', `> ${cmd}`);
    setInput('');

    const args = cmd.split(' ');
    const command = args[0].toLowerCase();
    const payload = args.slice(1).join(' ');

    switch (command) {
        case '/help':
            addLog('info', 'Available commands:');
            addLog('info', '  /broadcast <msg> - Send global alert to app users');
            addLog('info', '  /ban <id>        - Ban user by ID');
            addLog('info', '  /clear           - Clear terminal');
            addLog('info', '  /exit            - Close terminal');
            break;

        case '/clear':
            setLogs([]);
            break;

        case '/exit':
            onClose();
            break;

        case '/broadcast':
        case 'alert':
            if (!payload) {
                addLog('error', 'Usage: /broadcast <message>');
                return;
            }
            try {
                // ВАЖНО: Используем getCollection с appId, чтобы путь совпал с тем, что слушает App.jsx
                await addDoc(getCollection(db, appId, "broadcast_messages"), {
                    message: payload,
                    createdAt: serverTimestamp(),
                    createdBy: currentAdmin.id,
                    type: 'admin_alert'
                });
                addLog('success', 'Broadcast sent successfully! Users will see it in ~5 sec.');
            } catch (e) {
                addLog('error', `Error sending broadcast: ${e.message || 'Unknown error'}`);
            }
            break;

        case '/ban':
            if (!payload) {
                addLog('error', 'Usage: /ban <user_id>');
                return;
            }
            try {
                await setDoc(getDocument(db, appId, "banned_users", payload), {
                    name: 'Unknown (Banned via Console)',
                    bannedAt: serverTimestamp(),
                    bannedBy: `${currentAdmin.name} (Console)`
                });
                addLog('success', `User ID ${payload} has been banned.`);
            } catch (e) {
                addLog('error', `Ban failed: ${e.message || 'Unknown error'}`);
            }
            break;

        default:
            if (command.startsWith('/')) {
                addLog('error', `Unknown command: ${command}`);
            } else {
                 // Если набрали текст без команды, считаем это уведомлением (удобство)
                 executeCommand(`/broadcast ${cmdRaw}`);
            }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col font-mono text-sm animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-green-900/50 bg-black">
            <div className="flex items-center gap-2 text-green-500 font-bold">
                <Terminal size={18} />
                <span>ROOT_ACCESS@{currentAdmin?.id || 'GUEST'}</span>
            </div>
            <button onClick={onClose} className="text-green-700 hover:text-green-500"><X size={20} /></button>
        </div>

        {/* Logs Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1 text-green-400/80 custom-scrollbar">
            {logs.map((log) => (
                <div key={log.id} className={`${log.type === 'error' ? 'text-red-500' : log.type === 'success' ? 'text-green-400 font-bold' : log.type === 'input' ? 'text-white' : 'text-green-500/80'} break-words`}>
                    <span className="opacity-50 mr-2">[{log.time}]</span>
                    {log.text}
                </div>
            ))}
            <div ref={bottomRef} />
        </div>

        {/* Input Area */}
        <div className="p-3 bg-black border-t border-green-900/50 flex gap-2 items-center">
            <ChevronRight size={18} className="text-green-500 animate-pulse" />
            <input 
                autoFocus
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && executeCommand(input)}
                className="flex-1 bg-transparent border-none outline-none text-green-400 placeholder-green-900 font-mono"
                placeholder="Enter command (e.g., /broadcast Hello)..."
            />
        </div>
    </div>
  );
};

export default BotDashboard;