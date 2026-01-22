import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Home, User, PlusCircle, MapPin, Clock, Car, Search, Check, X, Bell, 
  MessageCircle, Trash2, AlertCircle, Loader2, LogOut, RefreshCw, Send, 
  Banknote, FileText, Shield, UserX, Ban, Lock, Users, Edit, Terminal, 
  ChevronRight, Play, Square, Save, AlertTriangle 
} from 'lucide-react';

// --- ИМПОРТЫ FIREBASE ---
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  deleteDoc, 
  doc, 
  updateDoc, 
  arrayUnion, 
  arrayRemove,
  runTransaction,
  serverTimestamp,
  orderBy,
  setDoc,
  getDoc,
  limit,
  where,
  collectionGroup,
  getDocs
} from "firebase/firestore";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "firebase/auth";

// --- НАСТРОЙКИ FIREBASE ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "AIzaSyCfvq5DliaTXTTPNOZzX4sJdF0xC7VK3z8",
  authDomain: "ufic-taxi.firebaseapp.com",
  projectId: "ufic-taxi",
  storageBucket: "ufic-taxi.firebasestorage.app",
  messagingSenderId: "457233125418",
  appId: "1:457233125418:web:f9f9053b2ef019f669b353"
};

const appId = typeof __app_id !== 'undefined' ? __app_id : 'ufic-taxi';

// Инициализация базы данных
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ БАЗЫ ДАННЫХ ---
const getCollection = (collectionName) => {
  return collection(db, 'artifacts', appId, 'public', 'data', collectionName);
};

const getDocument = (collectionName, docId) => {
  return doc(db, 'artifacts', appId, 'public', 'data', collectionName, docId);
};

// --- ИНТЕГРАЦИЯ С TELEGRAM ---
const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
  // Настройка цветов под тему
  if (tg.setHeaderColor) tg.setHeaderColor(tg.themeParams.bg_color || '#111827');
  if (tg.setBackgroundColor) tg.setBackgroundColor(tg.themeParams.bg_color || '#111827');
}

// Получаем данные пользователя
const user = tg?.initDataUnsafe?.user;

const USER_INFO = user ? {
  name: `${user.first_name} ${user.last_name || ''}`.trim(),
  id: user.id, 
  telegram: user.username,
} : {
  name: "Тестовый Пользователь",
  id: 999, 
  telegram: "test_user",
};

// --- НАСТРОЙКИ МОДЕРАЦИИ ---
// ID администраторов
const ADMIN_IDS = [999, 5105978639, USER_INFO.id]; 
const isAdmin = ADMIN_IDS.includes(USER_INFO.id);

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
const getTodayDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  date.setHours(0,0,0,0);
  today.setHours(0,0,0,0);
  tomorrow.setHours(0,0,0,0);

  if (date.getTime() === today.getTime()) return 'Сегодня';
  if (date.getTime() === tomorrow.getTime()) return 'Завтра';
  
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' });
};

// --- КОМПОНЕНТЫ ---

const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000); 
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgClass = type === 'error' ? 'bg-red-500' : (type === 'info' ? 'bg-blue-600' : 'bg-green-500');

  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium animate-fade-in-down w-[90%] max-w-sm ${bgClass}`}>
      {type === 'error' ? <AlertCircle size={20} className="shrink-0" /> : (type === 'info' ? <Bell size={20} className="shrink-0" /> : <Check size={20} className="shrink-0" />)}
      <div className="whitespace-pre-wrap">{message}</div>
    </div>
  );
};

// --- КОМПОНЕНТ: БОТ ДЭШБОРД (ВСТРОЕН) ---
function BotDashboard({ db, onClose }) {
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  // Токен храним в localStorage
  const [token, setToken] = useState(localStorage.getItem('bot_token') || '');
  
  const ridesCache = useRef({});
  const unsubscribers = useRef([]);
  const startTimeRef = useRef(null); // Метка времени запуска бота

  // Автоскролл логов
  const logsEndRef = useRef(null);
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (text, type = 'info') => {
    const time = new Date().toLocaleTimeString('ru-RU');
    setLogs(prev => [...prev.slice(-99), { time, text, type }]); // Храним последние 100 строк
  };

  const saveToken = () => {
    if (!token.trim()) return addLog("Введите токен!", "error");
    localStorage.setItem('bot_token', token.trim());
    addLog("Токен сохранен локально", 'success');
  };

  // --- ОТПРАВКА СООБЩЕНИЯ В TELEGRAM ---
  const sendTelegramMessage = async (chatId, text) => {
    if (!chatId || !token) return;
    
    // Защита от отправки на "фейковые" ID (тестовые юзеры)
    if (String(chatId).length < 5) return;

    try {
      addLog(`📤 Попытка отправки ID: ${chatId}...`, 'system');
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      
      const response = await fetch(url, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
              chat_id: chatId,
              text: text,
              parse_mode: 'HTML'
          })
      });
      
      const data = await response.json();
      
      if (data.ok) {
        addLog(`✅ Доставлено ID: ${chatId}`, 'success');
      } else {
        // Частая ошибка: юзер не нажал /start боту
        if (data.error_code === 403) {
            addLog(`⛔ Юзер ${chatId} заблокировал бота или не нажал /start`, 'error');
        } else {
            addLog(`❌ Ошибка API Telegram: ${data.description}`, 'error');
        }
      }
    } catch (error) {
      addLog(`❌ Ошибка сети: ${error.message}`, 'error');
    }
  };

  // --- ЗАПУСК БОТА ---
  const startBot = () => {
    if (!token) {
        alert("Пожалуйста, введите токен Telegram бота!");
        return;
    }
    
    setIsRunning(true);
    startTimeRef.current = new Date(); // Фиксируем время старта
    addLog("🚀 БОТ ЗАПУЩЕН. Слушаю новые события...", 'success');

    // 1. СЛУШАЕМ НОВЫЕ СООБЩЕНИЯ В ЧАТАХ ПОЕЗДОК
    // Используем collectionGroup для поиска во всех подколлекциях messages
    const qMessages = query(
        collectionGroup(db, 'messages'), 
        where('createdAt', '>', startTimeRef.current), // Только новые
        orderBy('createdAt', 'asc')
    );

    const unsubMsg = onSnapshot(qMessages, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
                const msg = change.doc.data();
                
                // Игнорируем системные сообщения и свои собственные (если админ пишет)
                if (msg.senderId === 'system') return;

                // Получаем ссылку на документ поездки (родитель родителя сообщения)
                const rideRef = change.doc.ref.parent.parent;
                if (!rideRef) return;

                try {
                    const rideSnap = await getDoc(rideRef);
                    if (!rideSnap.exists()) return;

                    const ride = rideSnap.data();
                    const recipients = new Set();
                    
                    // Логика: Уведомляем всех участников поездки, кроме автора сообщения
                    
                    // 1. Если автор сообщения НЕ водитель -> уведомляем водителя
                    if (ride.authorId !== msg.senderId) recipients.add(ride.authorId);
                    
                    // 2. Уведомляем других пассажиров (статус approved)
                    if (ride.requests) {
                        ride.requests.forEach(r => {
                            if (r.status === 'approved' && r.userId !== msg.senderId) {
                                recipients.add(r.userId);
                            }
                        });
                    }
                    
                    const text = `💬 <b>Новое сообщение в поездке</b>\n\n👤 <b>${msg.senderName}:</b>\n"${msg.text}"\n\n<i>Зайдите в приложение, чтобы ответить.</i>`;
                    
                    recipients.forEach(id => sendTelegramMessage(id, text));
                    if (recipients.size > 0) addLog(`📨 Оповещение о сообщении для ${recipients.size} чел.`);
                    
                } catch (e) {
                    addLog(`Ошибка при обработке сообщения: ${e.message}`, 'error');
                }
            }
        });
    }, (error) => addLog(`Ошибка listener Messages: ${error.message}`, 'error'));

    // 2. СЛУШАЕМ ИЗМЕНЕНИЯ В ПОЕЗДКАХ (Заявки, Статусы)
    // Слушаем ВСЕ поездки, фильтрацию делаем в памяти для надежности сравнения
    const qRides = query(collection(db, 'rides'));
    
    const unsubRides = onSnapshot(qRides, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const rideData = change.doc.data();
            const rideId = change.doc.id;
            const currentRequests = rideData.requests || [];

            // Если поездка только добавлена в listener
            if (change.type === 'added') {
                // Просто сохраняем состояние в кэш, НЕ уведомляем (это старые данные)
                ridesCache.current[rideId] = currentRequests;
                return; 
            }

            // Если поездка изменилась (кто-то подал заявку или изменил статус)
            if (change.type === 'modified') {
                const prevRequests = ridesCache.current[rideId] || [];

                // Проходимся по НОВЫМ заявкам
                currentRequests.forEach(newReq => {
                    const oldReq = prevRequests.find(r => r.userId === newReq.userId);

                    // 2.1 Новая заявка (в старом кэше её не было)
                    if (!oldReq) {
                        // Проверяем, что заявка свежая (не столетней давности, если вдруг timestamp сбоит)
                        // Но здесь мы полагаемся на то, что change.type='modified' сработал сейчас
                        
                        addLog(`🆕 Новая заявка от ${newReq.name}`, 'warning');
                        sendTelegramMessage(rideData.authorId, 
                            `🚕 <b>Новая заявка!</b>\n\n👤 <b>${newReq.name}</b> хочет поехать с вами.\n📍 Куда: ${rideData.destination}\n⏰ Время: ${rideData.time}\n\nЗайдите в приложение, чтобы принять или отклонить.`);
                    }
                    // 2.2 Изменение статуса
                    else if (oldReq.status !== newReq.status) {
                        addLog(`🔄 Статус изменен (${newReq.name}): ${newReq.status}`);
                        
                        if (newReq.status === 'approved') {
                            sendTelegramMessage(newReq.userId, 
                                `✅ <b>Ваша заявка принята!</b>\n\n🚘 Водитель: ${rideData.author}\n⏰ Время: ${rideData.time}\n📍 Назначение: ${rideData.destination}\n\nНе опаздывайте!`);
                        } else if (newReq.status === 'rejected') {
                            sendTelegramMessage(newReq.userId, 
                                `❌ <b>Заявка отклонена</b>\n\nК сожалению, водитель отклонил вашу заявку на поездку в ${rideData.time}. Попробуйте найти другую машину.`);
                        }
                    }
                });

                // Обновляем кэш
                ridesCache.current[rideId] = currentRequests;
            }

            if (change.type === 'removed') {
                delete ridesCache.current[rideId];
            }
        });
    }, (error) => addLog(`Ошибка listener Rides: ${error.message}`, 'error'));

    // 3. ТАЙМЕР НАПОМИНАНИЙ (Каждую минуту)
    const checkReminders = async () => {
         const now = new Date();
         // Напоминаем за 15 минут
         const reminderTime = new Date(now.getTime() + 15 * 60000); 
         const timeStr = reminderTime.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'});
         const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

         // Ищем поездки на СЕГОДНЯ, у которых время совпадает с reminderTime
         // ВАЖНО: Это сработает, только если формат времени в базе строго "HH:MM"
         
         // Чтобы не тянуть всю базу, делаем запрос
         const qToday = query(
             collection(db, 'rides'), 
             where('date', '==', dateStr),
             where('time', '==', timeStr),
             where('reminded', '!=', true) // Чтобы не отправлять дважды
         );
         
         try {
             const snap = await getDocs(qToday);
             snap.forEach(async (docSnap) => {
                 const r = docSnap.data();
                 addLog(`🔔 Отправка напоминания для поездки ${r.destination}`, 'system');

                 // Шлем автору
                 sendTelegramMessage(r.authorId, `⏰ <b>Напоминание</b>\nВаша поездка через 15 минут!\n📍 ${r.destination}`);

                 // Шлем пассажирам
                 if (r.requests) {
                     r.requests.forEach(req => {
                         if(req.status === 'approved') {
                             sendTelegramMessage(req.userId, `⏰ <b>Напоминание</b>\nПоездка через 15 минут!\n📍 ${r.destination}\n🚘 Водитель: ${r.author}`);
                         }
                     });
                 }

                 // Ставим флаг, что напомнили
                 await updateDoc(doc(db, 'rides', docSnap.id), { reminded: true });
             });
         } catch (e) {
             // Игнорируем ошибку "Missing or insufficient permissions", если правил нет
             if (!e.message.includes('permission')) {
                 addLog(`Ошибка напоминаний: ${e.message}`, 'error');
             }
         }
    };

    // Запуск интервала проверок
    const timerInterval = setInterval(() => {
        if (!startTimeRef.current) return;
        checkReminders();
    }, 60000); // Раз в минуту

    unsubscribers.current = [unsubMsg, unsubRides, () => clearInterval(timerInterval)];
  };

  const stopBot = () => {
    unsubscribers.current.forEach(u => u && u());
    unsubscribers.current = [];
    setIsRunning(false);
    startTimeRef.current = null;
    ridesCache.current = {};
    addLog("🛑 Бот остановлен.", 'system');
  };

  // Очистка при размонтировании
  useEffect(() => {
    return () => stopBot();
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-gray-900 text-white flex flex-col font-mono text-sm animate-fade-in">
      {/* HEADER */}
      <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center shadow-lg shrink-0">
        <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isRunning ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                <Terminal size={20} />
            </div>
            <div>
                <h2 className="font-bold text-lg leading-none">Bot Terminal v3.0</h2>
                <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                    Статус: <span className={isRunning ? "text-green-400 font-bold" : "text-gray-500"}>{isRunning ? "АКТИВЕН" : "ОСТАНОВЛЕН"}</span>
                </div>
            </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white px-3 py-1 rounded hover:bg-gray-700 transition">Закрыть</button>
      </div>

      {/* CONTROLS */}
      <div className="p-4 bg-gray-800/50 flex flex-col md:flex-row gap-4 border-b border-gray-700 shrink-0">
        <div className="flex-1 flex gap-2">
            <input 
                type="text" 
                value={token} 
                onChange={(e) => setToken(e.target.value)} 
                placeholder="Вставьте токен бота (например: 123456:ABC-Def...)"
                className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white focus:border-blue-500 outline-none transition-colors"
                disabled={isRunning}
            />
            <button onClick={saveToken} disabled={isRunning} className="px-4 bg-gray-700 rounded-lg hover:bg-gray-600 text-gray-300 transition" title="Сохранить токен"><Save size={20}/></button>
        </div>
        <div className="flex gap-2">
            {!isRunning ? (
                <button onClick={startBot} className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-bold shadow-lg shadow-green-900/20 transition-all active:scale-95 text-white">
                    <Play size={18} /> ЗАПУСТИТЬ
                </button>
            ) : (
                <button onClick={stopBot} className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-bold shadow-lg shadow-red-900/20 transition-all active:scale-95 animate-pulse text-white">
                    <Square size={18} /> ОСТАНОВИТЬ
                </button>
            )}
            <button onClick={() => setLogs([])} className="px-3 bg-gray-700 rounded-lg hover:bg-gray-600 text-gray-400 transition" title="Очистить консоль"><Trash2 size={20}/></button>
        </div>
      </div>

      {/* LOGS OUTPUT */}
      <div className="flex-1 bg-black p-4 overflow-y-auto font-mono text-xs md:text-sm custom-scrollbar">
        {logs.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-gray-600 space-y-2 opacity-50">
                <AlertTriangle size={48} />
                <p>Терминал готов к работе.</p>
                <p className="text-xs">Введите токен и нажмите "ЗАПУСТИТЬ" для обработки уведомлений.</p>
            </div>
        )}
        <div className="space-y-1.5">
            {logs.map((log, i) => (
                <div key={i} className={`flex gap-3 font-mono ${
                    log.type === 'error' ? 'text-red-400 bg-red-900/10' : 
                    log.type === 'success' ? 'text-green-400' : 
                    log.type === 'warning' ? 'text-yellow-400' : 
                    log.type === 'system' ? 'text-blue-400' :
                    'text-gray-300'
                } p-1 rounded hover:bg-white/5 transition-colors`}>
                    <span className="opacity-40 min-w-[60px] select-none">[{log.time}]</span>
                    <span className="break-all whitespace-pre-wrap">{log.text}</span>
                </div>
            ))}
            <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}

// Модальное окно редактирования заявки
const EditRideModal = ({ ride, onClose, onSave }) => {
  const [editedRide, setEditedRide] = useState({
    time: ride.time,
    destination: ride.destination,
    price: ride.price || '',
    comment: ride.comment || ''
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!editedRide.time || !editedRide.destination) {
      alert("Время и место обязательны");
      return;
    }
    setIsSaving(true);
    await onSave(ride.id, editedRide);
    setIsSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-gray-800 w-full max-w-sm rounded-2xl p-5 border border-gray-700 shadow-2xl">
        <h3 className="text-white text-lg font-bold mb-4 flex items-center gap-2">
          <Edit size={20} className="text-blue-500" /> Редактирование
        </h3>
        
        <div className="space-y-4">
          <div>
            <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Время</label>
            <input 
              type="time" 
              value={editedRide.time}
              onChange={(e) => setEditedRide({...editedRide, time: e.target.value})}
              className="w-full bg-gray-900 border border-gray-600 rounded-xl p-3 text-white text-sm focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Место назначения</label>
            <input 
              type="text" 
              value={editedRide.destination}
              onChange={(e) => setEditedRide({...editedRide, destination: e.target.value})}
              className="w-full bg-gray-900 border border-gray-600 rounded-xl p-3 text-white text-sm focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">{ride.isDriver ? 'Цена с человека' : 'Общая цена'}</label>
            <input 
              type="number" 
              value={editedRide.price}
              onChange={(e) => setEditedRide({...editedRide, price: e.target.value})}
              className="w-full bg-gray-900 border border-gray-600 rounded-xl p-3 text-white text-sm focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Комментарий</label>
            <textarea 
              rows="2"
              value={editedRide.comment}
              onChange={(e) => setEditedRide({...editedRide, comment: e.target.value})}
              className="w-full bg-gray-900 border border-gray-600 rounded-xl p-3 text-white text-sm focus:border-blue-500 outline-none resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-700 text-gray-300 font-bold text-sm">Отмена</button>
          <button 
            onClick={handleSave} 
            disabled={isSaving}
            className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2"
          >
            {isSaving ? <Loader2 className="animate-spin" size={16} /> : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Модальное окно Админ-панели (список юзеров и бан)
const AdminPanelModal = ({ onClose, currentAdminName }) => {
  const [activeTab, setActiveTab] = useState('all'); 
  const [bannedUsers, setBannedUsers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(getCollection("banned_users"), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Сортировка на клиенте (новые баны сверху)
      data.sort((a, b) => (b.bannedAt?.seconds || 0) - (a.bannedAt?.seconds || 0));
      setBannedUsers(data);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(getCollection("users"), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Сортировка по времени последнего входа
      data.sort((a, b) => (b.lastSeen?.seconds || 0) - (a.lastSeen?.seconds || 0));
      setAllUsers(data);
    });
    return () => unsubscribe();
  }, []);

  const handleBan = async (targetUser) => {
    if (!window.confirm(`Забанить пользователя ${targetUser.name}?`)) return;
    try {
      await setDoc(getDocument("banned_users", String(targetUser.id)), {
        name: targetUser.name,
        bannedAt: serverTimestamp(),
        bannedBy: currentAdminName
      });
    } catch (e) {
      console.error(e);
      alert("Ошибка при бане");
    }
  };

  const handleUnban = async (userId) => {
    if (!window.confirm("Разблокировать этого пользователя?")) return;
    try {
      await deleteDoc(getDocument("banned_users", String(userId)));
    } catch (e) {
      console.error(e);
      alert("Ошибка при разбане");
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-sm flex flex-col animate-fade-in">
      <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2 text-white font-bold">
           <Users className="text-blue-500" size={20} /> Пользователи
           <span className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full text-xs ml-2">{allUsers.length}</span>
        </div>
        <button onClick={onClose} className="p-2 bg-gray-700 rounded-full hover:bg-gray-600 text-white">
          <X size={20} />
        </button>
      </div>

      <div className="flex border-b border-gray-700">
        <button onClick={() => setActiveTab('all')} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'all' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400'}`}>Все пользователи</button>
        <button onClick={() => setActiveTab('banned')} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'banned' ? 'text-red-400 border-b-2 border-red-400' : 'text-gray-400'}`}>Забаненные ({bannedUsers.length})</button>
      </div>
      
      <div className="p-4 overflow-y-auto flex-1">
        {activeTab === 'all' && (
          <div className="space-y-3">
            {allUsers.map(u => {
              const isUserBanned = bannedUsers.some(b => b.id === u.id);
              return (
                <div key={u.id} className="bg-gray-900 border border-gray-700 p-3 rounded-xl flex justify-between items-center">
                  <div>
                    <div className="text-white font-bold text-sm flex items-center gap-2">
                      {u.name}
                      {u.telegram && <a href={`https://t.me/${u.telegram}`} target="_blank" className="text-blue-500"><MessageCircle size={12}/></a>}
                    </div>
                    <div className="text-gray-500 text-[10px]">ID: {u.id}</div>
                    {u.lastSeen && <div className="text-gray-600 text-[10px]">Был: {new Date(u.lastSeen.seconds * 1000).toLocaleDateString()}</div>}
                  </div>
                  {isUserBanned ? (
                    <span className="text-red-500 text-xs font-bold border border-red-500/30 px-2 py-1 rounded bg-red-500/10">BANNED</span>
                  ) : (
                    <button onClick={() => handleBan(u)} className="bg-red-600/20 text-red-400 px-3 py-1.5 rounded-lg text-xs font-bold border border-red-600/30 hover:bg-red-600/30 flex items-center gap-1"><Ban size={12} /> Бан</button>
                  )}
                </div>
              );
            })}
            {allUsers.length === 0 && <div className="text-center text-gray-500">Нет данных о пользователях</div>}
          </div>
        )}
        {activeTab === 'banned' && (
          <div className="space-y-3">
            {bannedUsers.length === 0 ? <div className="text-center text-gray-500 mt-10">Список пуст</div> : (
              bannedUsers.map(u => (
                <div key={u.id} className="bg-gray-900 border border-gray-700 p-3 rounded-xl flex justify-between items-center">
                  <div>
                    <div className="text-white font-bold text-sm">{u.name}</div>
                    <div className="text-gray-500 text-xs">ID: {u.id}</div>
                    <div className="text-red-900 text-[10px] mt-1">Забанил: {u.bannedBy}</div>
                  </div>
                  <button onClick={() => handleUnban(u.id)} className="bg-green-600/20 text-green-400 px-3 py-1.5 rounded-lg text-xs font-bold border border-green-600/30 hover:bg-green-600/30">Разбанить</button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Окно Чата
const ChatModal = ({ ride, currentUser, onClose }) => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!ride?.id) return;
    // Фильтруем сообщения конкретной поездки
    const q = query(getCollection("messages"), where("rideId", "==", ride.id));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Сортировка на клиенте
      docs.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
      setMessages(docs);
    });
    return () => unsubscribe();
  }, [ride.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim()) return;
    try {
      await addDoc(getCollection("messages"), {
        rideId: ride.id, 
        text: newMessage,
        senderId: currentUser.id,
        senderName: currentUser.name,
        createdAt: serverTimestamp()
      });
      setNewMessage("");
    } catch (error) {
      console.error("Ошибка отправки:", error);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex flex-col animate-fade-in">
      <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center shrink-0">
        <div>
           <div className="font-bold text-white text-sm">Чат поездки</div>
           <div className="text-xs text-gray-400">{ride.destination} • {ride.time}</div>
        </div>
        <button onClick={onClose} className="p-2 bg-gray-700 rounded-full hover:bg-gray-600">
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-900">
        {messages.length === 0 && <div className="text-center text-gray-500 text-xs mt-10">Здесь можно обсудить детали поездки.<br/>Сообщения видны водителю и пассажирам.</div>}
        {messages.map((msg) => {
          const isMe = msg.senderId === currentUser.id;
          const isSystem = msg.senderId === 'system';
          
          if (isSystem) {
             return (
               <div key={msg.id} className="flex justify-center my-2">
                  <div className="bg-gray-800 text-gray-400 text-[10px] px-3 py-1 rounded-full border border-gray-700/50 flex items-center gap-1">
                     <AlertCircle size={10} /> {msg.text}
                  </div>
               </div>
             )
          }

          return (
            <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
               <div className={`max-w-[85%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                 {!isMe && <span className="text-[10px] text-gray-400 ml-1 mb-0.5">{msg.senderName}</span>}
                 <div className={`px-3 py-2 rounded-xl text-sm break-words ${isMe ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-gray-700 text-gray-200 rounded-tl-none'}`}>
                   {msg.text}
                 </div>
               </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-3 bg-gray-800 border-t border-gray-700 shrink-0 pb-safe">
        <div className="flex gap-2">
          <input 
            type="text" 
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Напишите сообщение..."
            className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 text-white"
          />
          <button onClick={handleSend} className="bg-blue-600 text-white p-3 rounded-xl hover:bg-blue-500 active:scale-95 transition"><Send size={20} /></button>
        </div>
      </div>
    </div>
  );
};

// --- ОСНОВНОЙ КОМПОНЕНТ ПРИЛОЖЕНИЯ ---
export default function TaxiShareApp() {
  const [activeTab, setActiveTab] = useState('list'); 
  const [rides, setRides] = useState([]); 
  const [filter, setFilter] = useState('all'); 
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0); 
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState(null); 
  
  const [isBanned, setIsBanned] = useState(false);
  const [adminMode, setAdminMode] = useState(false); 
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  
  // Состояние открытия терминала
  const [isBotDashboardOpen, setIsBotDashboardOpen] = useState(false);

  const [activeChatRide, setActiveChatRide] = useState(null);
  const [editingRide, setEditingRide] = useState(null);
  const [userAuth, setUserAuth] = useState(null); 
  
  // Для счетчика пользователей в админке
  const [totalUsersCount, setTotalUsersCount] = useState(0);

  const prevRequestsRef = useRef({});

  const showToast = (message, type = 'success') => setToast({ message, type });

  const [newRide, setNewRide] = useState({
    direction: 'to_city',
    date: getTodayDateString(),
    time: '',
    destination: '',
    seatsTotal: 3,
    price: '',
    comment: '',
    isDriver: false 
  });

  // ИНИЦИАЛИЗАЦИЯ AUTH
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth Error:", error);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
        setUserAuth(u);
    });
    return () => unsubscribe();
  }, []);

  // Получаем общее число пользователей для админки
  useEffect(() => {
     if (isAdmin && userAuth) {
        const unsubscribe = onSnapshot(getCollection("users"), (snap) => {
            setTotalUsersCount(snap.size);
        });
        return () => unsubscribe();
     }
  }, [isAdmin, userAuth]);

  // Слушатель глобальных уведомлений (внутри приложения)
  useEffect(() => {
    if (!userAuth) return;
    const q = query(getCollection("broadcast_messages"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
                // Показываем только свежие уведомления (последние 30 сек)
                if (createdAt && (new Date() - createdAt) < 30000) {
                    if (data.createdBy !== USER_INFO.id) {
                        showToast(data.message, 'info');
                    }
                }
            }
        });
    });
    return () => unsubscribe();
  }, [userAuth]);

  // Авто-коррекция мест
  useEffect(() => {
     if (newRide.isDriver) {
        if (newRide.seatsTotal > 4) setNewRide(prev => ({...prev, seatsTotal: 4}));
     } else {
        if (newRide.seatsTotal > 3) setNewRide(prev => ({...prev, seatsTotal: 3}));
     }
  }, [newRide.isDriver]);

  // Проверка статуса бана и обновление lastSeen
  useEffect(() => {
    if (!userAuth) return;

    const checkUser = async () => {
       const userBanRef = getDocument("banned_users", String(USER_INFO.id));
       const banSnap = await getDoc(userBanRef);
       
       if (banSnap.exists()) {
         setIsBanned(true);
         setLoading(false);
         return; 
       } else {
         setIsBanned(false);
       }

       try {
         await setDoc(getDocument("users", String(USER_INFO.id)), {
           id: USER_INFO.id,
           name: USER_INFO.name,
           telegram: USER_INFO.telegram || '',
           lastSeen: serverTimestamp()
         }, { merge: true });
       } catch (e) {
         console.error("Ошибка сохранения юзера", e);
       }
    };

    checkUser();
    const unsubscribe = onSnapshot(getDocument("banned_users", String(USER_INFO.id)), (doc) => {
        setIsBanned(doc.exists());
    });
    return () => unsubscribe();
  }, [userAuth]);

  // Загрузка поездок
  useEffect(() => {
    if (isBanned || !userAuth) return; 
    setLoading(true);
    const q = query(getCollection("rides"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ridesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      const now = new Date();
      // Удаляем из просмотра через 10 минут после старта
      const expirationTime = now.getTime() - (10 * 60 * 1000); 

      const validRides = ridesData.filter(r => {
        const rideDate = new Date(`${r.date}T${r.time || '00:00'}`);
        return rideDate.getTime() > expirationTime;
      });

      validRides.sort((a, b) => {
        const dateA = new Date(`${a.date}T${a.time}`);
        const dateB = new Date(`${b.date}T${b.time}`);
        return dateA - dateB;
      });
      setRides(validRides);
      setLoading(false);
    }, (error) => {
      console.error("Ошибка Firestore:", error);
      if (!isBanned) showToast("Ошибка соединения с базой", 'error');
      setLoading(false);
    });
    return () => unsubscribe();
  }, [refreshKey, isBanned, userAuth]);

  // Уведомления о смене статуса заявки (внутри приложения)
  useEffect(() => {
    if (rides.length === 0) return;
    rides.forEach(ride => {
      const myRequest = (ride.requests || []).find(r => r.userId === USER_INFO.id);
      
      if (!myRequest) return; 

      const prevStatus = prevRequestsRef.current[ride.id];
      const currentStatus = myRequest.status;
      if (prevStatus && prevStatus !== currentStatus) {
        if (currentStatus === 'approved') showToast(`Ваша заявка на ${ride.time} принята!`, 'success');
        else if (currentStatus === 'rejected') showToast(`Заявка на ${ride.time} отклонена`, 'error');
      }
      prevRequestsRef.current[ride.id] = currentStatus;
    });
  }, [rides]);

  // Логика пиковых часов (Client-side toast alerts)
  useEffect(() => {
    const checkPeakHours = () => {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        
        const isMorningPeak = hours === 8 && minutes === 45;
        const isEveningPeak = hours === 14 && minutes === 45;

        if (isMorningPeak || isEveningPeak) {
             const key = `notified_${now.getDate()}_${hours}`;
             if (sessionStorage.getItem(key)) return;

             const amIBusy = rides.some(r => 
                 r.authorId === USER_INFO.id || 
                 (r.requests || []).some(req => req.userId === USER_INFO.id && req.status === 'approved')
             );

             if (!amIBusy) {
                 const cityRides = rides.filter(r => r.direction === 'to_city');
                 const totalSeats = cityRides.reduce((acc, r) => acc + (r.seatsTotal - r.seatsTaken), 0);
                 
                 if (cityRides.length > 0) {
                     showToast(`🚕 На 09:00 есть ${cityRides.length} поездок в город (${totalSeats} мест)`, 'info');
                 }
                 
                 if (isEveningPeak) {
                     const ridesCount = rides.length;
                     const freeSeats = rides.reduce((acc, r) => acc + (r.seatsTotal - r.seatsTaken), 0);
                     if (ridesCount > 0) {
                        showToast(`🚕 Актуально: ${ridesCount} поездок, ${freeSeats} свободных мест`, 'info');
                     }
                 }
             }
             sessionStorage.setItem(key, 'true');
        }
    };

    const interval = setInterval(checkPeakHours, 10000); 
    return () => clearInterval(interval);
  }, [rides]);

  // Вычисляемые значения
  const incomingRequestsCount = useMemo(() => {
    return rides
      .filter(r => r.authorId === USER_INFO.id)
      .reduce((acc, ride) => acc + (ride.requests || []).filter(req => req.status === 'pending').length, 0);
  }, [rides]);

  const myPassengerRides = useMemo(() => {
      return rides.filter(r => (r.requests || []).some(req => req.userId === USER_INFO.id));
  }, [rides]);

  // --- ОБРАБОТЧИКИ ДЕЙСТВИЙ ---

  const handleBanUser = async (targetUserId, targetUserName) => {
    if (!window.confirm(`Вы уверены, что хотите ЗАБАНИТЬ пользователя ${targetUserName}?`)) return;
    try {
      await setDoc(getDocument("banned_users", String(targetUserId)), {
        name: targetUserName,
        bannedAt: serverTimestamp(),
        bannedBy: USER_INFO.name
      });
      showToast(`Пользователь ${targetUserName} забанен`, 'success');
    } catch (e) {
      console.error(e);
      showToast("Ошибка при бане", 'error');
    }
  };

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
    showToast("Список обновлен");
  };

  const handleUpdateRide = async (rideId, updatedData) => {
    try {
      const rideRef = getDocument("rides", rideId);
      await updateDoc(rideRef, {
        time: updatedData.time,
        destination: updatedData.destination,
        price: updatedData.price ? parseInt(updatedData.price) : null,
        comment: updatedData.comment
      });
      // Чат - уведомление об изменении
      await addDoc(getCollection("messages"), {
        rideId: rideId,
        text: `📝 Внимание! Организатор изменил условия поездки.\nНовое время: ${updatedData.time}\nНазначение: ${updatedData.destination}`,
        senderId: 'system',
        senderName: 'System',
        createdAt: serverTimestamp()
      });
      showToast("Поездка обновлена");
    } catch (e) {
      console.error(e);
      showToast("Ошибка обновления", 'error');
    }
  };

  const handleCreateRide = async () => {
    const myActiveRidesCount = rides.filter(r => r.authorId === USER_INFO.id).length;
    if (myActiveRidesCount >= 5) {
      showToast("Лимит: макс. 5 активных поездок", 'error');
      return;
    }
    if (!newRide.time || !newRide.destination || !newRide.date) {
      showToast("Заполните основные поля", 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      await addDoc(getCollection("rides"), {
        author: USER_INFO.name,
        authorId: USER_INFO.id,
        telegram: USER_INFO.telegram || '',
        ...newRide,
        price: newRide.price ? parseInt(newRide.price) : null,
        comment: newRide.comment.trim(), 
        isDriver: newRide.isDriver || false,
        seatsTaken: 0,
        requests: [],
        status: "active",
        createdAt: serverTimestamp() 
      });

      const dateStr = formatDate(newRide.date);
      const directionStr = newRide.direction === 'to_city' ? 'В Город' : 'В УФИЦ';
      const notificationText = `🚗 Новая поездка!\n📅 Дата: ${dateStr}\n⏰ Время: ${newRide.time}\n📍 Назначение: ${newRide.destination}\n🧭 Направление: ${directionStr}`;

      // Отправляем в коллекцию уведомлений (для клиентов в приложении)
      await addDoc(getCollection("broadcast_messages"), {
         message: notificationText,
         createdAt: serverTimestamp(),
         createdBy: USER_INFO.id,
         type: 'new_ride_alert'
      });

      showToast("Поездка создана!");
      setActiveTab('list');
      setNewRide(prev => ({ ...prev, time: '', destination: '', price: '', comment: '', isDriver: false })); 
    } catch (e) {
      console.error(e);
      showToast("Ошибка при создании", 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRide = async (rideId) => {
    if (!window.confirm("Удалить эту поездку?")) return;
    try {
      await deleteDoc(getDocument("rides", rideId));
      showToast("Поездка удалена");
    } catch (e) {
      showToast("Не удалось удалить", 'error');
    }
  };

  const handleRequestJoin = async (ride) => {
    if (isSubmitting) return;
    if (ride.seatsTaken >= ride.seatsTotal) {
      showToast("Места закончились", 'error');
      return;
    }
    setIsSubmitting(true);
    const rideRef = getDocument("rides", ride.id);
    const newRequest = { 
      userId: USER_INFO.id, 
      name: USER_INFO.name, 
      telegram: USER_INFO.telegram,
      status: "pending" 
    };
    try {
      await updateDoc(rideRef, { requests: arrayUnion(newRequest) });
      showToast("Заявка отправлена");
    } catch (e) {
      showToast("Ошибка отправки", 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = async (ride) => {
    if (!window.confirm("Выйти из этой поездки?")) return;
    
    setIsSubmitting(true);
    const rideRef = getDocument("rides", ride.id);

    try {
      await runTransaction(db, async (transaction) => {
        const docSnapshot = await transaction.get(rideRef);
        if (!docSnapshot.exists()) throw "Поездка не найдена";
        
        const data = docSnapshot.data();
        const myRequestIndex = (data.requests || []).findIndex(r => r.userId === USER_INFO.id);
        
        if (myRequestIndex === -1) {
             return;
        }

        const myRequest = data.requests[myRequestIndex];
        const newRequests = data.requests.filter(r => r.userId !== USER_INFO.id);
        
        let newSeatsTaken = data.seatsTaken;
        if (myRequest.status === 'approved') {
             newSeatsTaken = Math.max(0, data.seatsTaken - 1);
        }

        transaction.update(rideRef, { 
            requests: newRequests, 
            seatsTaken: newSeatsTaken 
        });
      });

      showToast("Вы вышли из поездки");
    } catch (e) {
      console.error(e);
      showToast("Ошибка отмены", 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAcceptRequest = async (rideId, userId) => {
    setIsSubmitting(true);
    const rideRef = getDocument("rides", rideId);
    try {
      await runTransaction(db, async (transaction) => {
        const rideDoc = await transaction.get(rideRef);
        if (!rideDoc.exists()) throw "Поездка не найдена";
        const data = rideDoc.data();
        if (data.seatsTaken >= data.seatsTotal) throw "Нет свободных мест!"; 
        
        const updatedRequests = data.requests.map(req => req.userId === userId ? { ...req, status: "approved" } : req);
        
        transaction.update(rideRef, { requests: updatedRequests, seatsTaken: data.seatsTaken + 1 });
      });
      showToast("Пассажир принят!");
    } catch (e) {
      const msg = typeof e === 'string' ? e : "Ошибка обновления";
      showToast(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectRequest = async (ride, userId) => {
    if (!window.confirm("Отклонить/Исключить пассажира?")) return;
    
    setIsSubmitting(true);
    const rideRef = getDocument("rides", ride.id);

    try {
        await runTransaction(db, async (transaction) => {
            const rideDoc = await transaction.get(rideRef);
            if (!rideDoc.exists()) throw "Поездка не найдена";
            
            const data = rideDoc.data();
            const currentRequests = data.requests || [];
            
            const requestIndex = currentRequests.findIndex(r => r.userId === userId);
            if (requestIndex === -1) return; 

            const currentStatus = currentRequests[requestIndex].status;
            
            let newSeatsTaken = data.seatsTaken;
            if (currentStatus === 'approved') {
                newSeatsTaken = Math.max(0, data.seatsTaken - 1);
            }

            const updatedRequests = [...currentRequests];
            updatedRequests[requestIndex] = {
                ...updatedRequests[requestIndex],
                status: 'rejected'
            };

            transaction.update(rideRef, { 
                requests: updatedRequests, 
                seatsTaken: newSeatsTaken 
            });
        });

        showToast("Заявка отклонена");
    } catch (e) {
        console.error("Error rejecting request:", e);
        showToast("Ошибка при отклонении", 'error');
    } finally {
        setIsSubmitting(false);
    }
  };

  const getPriceDisplay = (ride) => {
    if (!ride.price) return null;
    if (ride.isDriver) {
      return `${ride.price} ₽`;
    } else {
      const maxPrice = Math.round(ride.price / 2);
      const minPrice = Math.round(ride.price / (1 + ride.seatsTotal));
      if (minPrice === maxPrice) return `~${maxPrice} ₽`;
      return `${minPrice} - ${maxPrice} ₽`;
    }
  };

  // --- УБРАНА БЛОКИРОВКА ИНТЕРФЕЙСА ---
  // Блок, который возвращал "Lock" экран, удален.

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans selection:bg-blue-500/30 pb-24">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      
      {activeChatRide && <ChatModal ride={activeChatRide} currentUser={USER_INFO} onClose={() => setActiveChatRide(null)} />}
      {isAdminPanelOpen && <AdminPanelModal onClose={() => setIsAdminPanelOpen(false)} currentAdminName={USER_INFO.name} />}
      {editingRide && <EditRideModal ride={editingRide} onClose={() => setEditingRide(null)} onSave={handleUpdateRide} />}

      {/* --- ИНТЕГРАЦИЯ НОВОГО DASHBOARD --- */}
      {isBotDashboardOpen && (
        <BotDashboard 
            db={db} 
            onClose={() => setIsBotDashboardOpen(false)} 
        />
      )}

      <div className="sticky top-0 z-40 bg-gray-900/95 backdrop-blur-md border-b border-gray-800 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
           <div 
             className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-lg transition-colors ${isAdmin ? (adminMode ? 'bg-red-600 shadow-red-500/20 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600 cursor-pointer') : 'bg-gradient-to-tr from-blue-600 to-blue-400 shadow-blue-500/20'}`}
             onClick={() => isAdmin && setAdminMode(!adminMode)}
           >
             {isAdmin ? <Shield size={18} className={adminMode ? "text-white" : "text-gray-400"} /> : <Car size={18} className="text-white" />}
           </div>
           <div>
             <div className="text-sm font-bold text-white leading-none">UFIC</div>
             <div className="text-[10px] text-gray-400 font-medium">Taxi Sharing {adminMode && <span className="text-red-400 font-bold">(ADMIN)</span>}</div>
           </div>
        </div>
        <div className="flex items-center gap-2">
            {isAdmin && adminMode && (
                <>
                  <button 
                    onClick={() => setIsBotDashboardOpen(true)} 
                    className="bg-gray-800 p-2 rounded-lg text-green-400 hover:bg-gray-700 border border-gray-700"
                  >
                    <Terminal size={16} />
                  </button>
                  <button onClick={() => setIsAdminPanelOpen(true)} className="bg-gray-800 p-2 rounded-lg text-blue-400 hover:bg-gray-700 border border-gray-700 flex items-center gap-1">
                    <Users size={16} />
                    <span className="text-xs font-bold">{totalUsersCount}</span>
                  </button>
                </>
            )}
            <span className="text-[10px] bg-gray-800 px-2 py-1 rounded text-gray-400 border border-gray-700">{USER_INFO.name.split(' ')[0]}</span>
        </div>
      </div>

      <main className="p-4">
        {activeTab === 'list' && (
            <div className="animate-fade-in space-y-4">
              <div className="flex gap-2 mb-4">
                <div className="flex-1 flex bg-gray-800 p-1 rounded-xl border border-gray-700">
                  <button onClick={() => setFilter('all')} className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${filter === 'all' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-300'}`}>Все</button>
                  <button onClick={() => setFilter('to_city')} className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${filter === 'to_city' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-300'}`}>В Город</button>
                  <button onClick={() => setFilter('to_center')} className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${filter === 'to_center' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-300'}`}>В УФИЦ</button>
                </div>
                <button onClick={handleRefresh} className="bg-gray-800 p-3 rounded-xl border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700 active:scale-95 transition"><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
              </div>

              {rides.filter(ride => {
                    if (ride.authorId === USER_INFO.id) return false;
                    if (filter === 'all') return true;
                    return ride.direction === filter;
                }).length === 0 ? (
                <div className="text-center py-16 text-gray-500 flex flex-col items-center">
                  <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4"><Search size={32} className="opacity-20" /></div>
                  <p className="text-sm">Актуальных поездок нет.</p>
                  <p className="text-xs text-gray-600 mt-1">Будьте первым, создайте поездку!</p>
                  <button onClick={() => setActiveTab('create')} className="mt-4 text-blue-400 text-sm font-medium hover:underline">Создать поездку</button>
                </div>
              ) : (
                rides.filter(ride => {
                    if (ride.authorId === USER_INFO.id) return false;
                    if (filter === 'all') return true;
                    return ride.direction === filter;
                }).map(ride => {
                  const isAuthor = ride.authorId === USER_INFO.id;
                  const myRequest = (ride.requests || []).find(r => r.userId === USER_INFO.id);
                  const isPending = myRequest?.status === 'pending';
                  const isApproved = myRequest?.status === 'approved';
                  const isRejected = myRequest?.status === 'rejected';
                  const seatsLeft = ride.seatsTotal - ride.seatsTaken;
                  const isFull = seatsLeft <= 0;
                  const priceDisplay = getPriceDisplay(ride);
                  
                  const rideDateObj = new Date(`${ride.date}T${ride.time}`);
                  const now = new Date();
                  const isFrozen = now >= rideDateObj;

                  return (
                    <div key={ride.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-sm relative overflow-hidden group mt-4">
                      <div className={`absolute top-0 left-0 px-2 py-1 rounded-br-lg text-[9px] font-bold uppercase tracking-wider text-white shadow-sm ${ride.direction === 'to_city' ? 'bg-blue-600' : 'bg-green-600'}`}>
                         {ride.direction === 'to_city' ? 'В ГОРОД' : 'В УФИЦ'}
                      </div>

                      <div className="flex justify-between items-start mb-3 pl-1 pt-4">
                        <div className="flex-1">
                          <div className="flex items-center justify-between pr-2">
                             <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                                <div className="flex items-center gap-1">
                                   {ride.isDriver ? <Car size={14} className="text-yellow-500"/> : <User size={14} />} 
                                   <button 
                                      onClick={() => setActiveChatRide(ride)} 
                                      className={`truncate max-w-[120px] text-left hover:underline ${ride.isDriver ? 'text-yellow-500 font-bold' : 'text-gray-300'}`}
                                   >
                                      {ride.author}
                                   </button>
                                </div>
                                {ride.telegram && !isAuthor && (
                                  <a href={`https://t.me/${ride.telegram}`} className="text-blue-400 hover:text-blue-300" onClick={(e) => e.stopPropagation()}><MessageCircle size={14} /></a>
                                )}
                             </div>
                             {priceDisplay && (
                               <div className="flex items-center gap-1 bg-gray-700/50 px-2 py-1 rounded text-xs text-green-400 font-medium border border-gray-600/50">{priceDisplay}<User size={10} className="opacity-50" /></div>
                             )}
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                              <span className="text-2xl font-bold text-white tracking-tight">{ride.time}</span>
                              <span className="text-xs font-medium text-gray-400 bg-gray-900/50 px-2 py-1 rounded-md border border-gray-700/50">{formatDate(ride.date)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-4 text-gray-300 bg-gray-900/30 p-2 rounded-lg border border-gray-700/30">
                        <MapPin size={16} className={`${ride.direction === 'to_city' ? 'text-blue-500' : 'text-green-500'} flex-shrink-0`} />
                        <span className="text-sm font-medium truncate">{ride.destination}</span>
                      </div>
                      {ride.comment && (
                        <div className="mb-4 text-gray-400 text-xs italic bg-gray-800/50 p-2 rounded border border-gray-700/30 flex gap-2"><FileText size={14} className="flex-shrink-0 mt-0.5" />"{ride.comment}"</div>
                      )}
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-1.5">
                          {Array.from({ length: ride.seatsTotal }).map((_, idx) => {
                             const isTaken = idx < ride.seatsTaken;
                             return (<div key={idx} className={`w-2.5 h-2.5 rounded-full transition-colors ${isTaken ? 'bg-green-500' : 'bg-gray-600'}`}></div>);
                          })}
                          <span className="text-[10px] text-gray-500 ml-1 uppercase font-bold">{seatsLeft > 0 ? `${seatsLeft} своб.` : 'FULL'}</span>
                        </div>
                        <div className="flex gap-2">
                            {adminMode && (
                                <>
                                  <button onClick={(e) => { e.stopPropagation(); handleBanUser(ride.authorId, ride.author); }} className="p-2 bg-red-900/30 text-red-400 rounded-lg border border-red-500/50 hover:bg-red-900/50 transition-colors" title="Забанить"><UserX size={16} /></button>
                                  <button onClick={(e) => { e.stopPropagation(); handleDeleteRide(ride.id); }} className="p-2 bg-red-900/30 text-red-400 rounded-lg border border-red-500/50 hover:bg-red-900/50 transition-colors" title="Удалить"><Trash2 size={16} /></button>
                                </>
                            )}
                            
                            {isFrozen && !isApproved && !isAuthor ? (
                                <div className="px-3 py-2 bg-gray-700/50 text-gray-500 rounded-lg text-xs font-bold border border-gray-600/30 cursor-not-allowed">УЖЕ В ПУТИ</div>
                            ) : (
                                <>
                                    {isAuthor ? (
                                    <div className="px-3 py-2 bg-gray-700/50 text-gray-400 rounded-lg text-xs font-bold border border-gray-600/30 cursor-default">ВАША ПОЕЗДКА</div>
                                    ) : isApproved ? (
                                    <div className="flex gap-2">
                                        <div className="px-3 py-2 bg-green-500/20 text-green-400 rounded-lg text-xs font-bold flex items-center gap-1 border border-green-500/30"><Check size={14} /> ВЫ ЕДЕТЕ</div>
                                        {/* Разрешаем выход, даже если заморожено */}
                                        <button onClick={() => handleCancelRequest(ride)} disabled={isFrozen} className="p-2 bg-gray-700 text-gray-400 rounded-lg hover:bg-gray-600 hover:text-white disabled:opacity-50"><LogOut size={14} /></button>
                                    </div>
                                    ) : isRejected ? (
                                    <div className="px-3 py-2 bg-red-500/20 text-red-400 rounded-lg text-xs font-bold border border-red-500/30">ОТКАЗАНО</div>
                                    ) : isPending ? (
                                    <button onClick={() => handleCancelRequest(ride)} className="px-3 py-2 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 rounded-lg text-xs font-bold border border-yellow-500/20 flex items-center gap-1 transition-colors"><Clock size={14} /> ОЖИДАНИЕ...</button>
                                    ) : (
                                    <button onClick={() => handleRequestJoin(ride)} disabled={isFull || isSubmitting || isFrozen} className={`px-4 py-2 rounded-lg text-sm font-bold shadow-lg transition-all active:scale-95 flex items-center gap-2 ${isFull || isFrozen ? 'bg-gray-700 text-gray-500 cursor-not-allowed shadow-none' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20'}`}>{isSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Поехать'}</button>
                                    )}
                                </>
                            )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
        )}

        {/* СОЗДАНИЕ */}
        {activeTab === 'create' && (
            <div className="animate-fade-in space-y-6 pt-2">
              <h2 className="text-xl font-bold text-center mb-6">Новая поездка</h2>
              <div className="space-y-5">
                <div className="bg-gray-800 p-1 rounded-xl flex border border-gray-700">
                    <button onClick={() => setNewRide({...newRide, isDriver: false})} className={`flex-1 py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${!newRide.isDriver ? 'bg-gray-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}><User size={16} /> Я Пассажир</button>
                    <button onClick={() => setNewRide({...newRide, isDriver: true})} className={`flex-1 py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${newRide.isDriver ? 'bg-yellow-600 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}><Car size={16} /> Я Водитель</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setNewRide({...newRide, direction: 'to_city'})} className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${newRide.direction === 'to_city' ? 'border-blue-500 bg-blue-500/10 text-blue-400 shadow-lg shadow-blue-500/10' : 'border-gray-800 bg-gray-800 text-gray-500'}`}><Car size={24} /><span className="text-xs font-bold uppercase">В Город</span></button>
                    <button onClick={() => setNewRide({...newRide, direction: 'to_center'})} className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${newRide.direction === 'to_center' ? 'border-green-500 bg-green-500/10 text-green-400 shadow-lg shadow-green-500/10' : 'border-gray-800 bg-gray-800 text-gray-500'}`}><Home size={24} /><span className="text-xs font-bold uppercase">В УФИЦ</span></button>
                </div>
                <div className="flex gap-3">
                   <div className="flex-1 space-y-2">
                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Дата</label>
                    <div className="relative"><input type="date" value={newRide.date} min={getTodayDateString()} onChange={(e) => setNewRide({...newRide, date: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors" /></div>
                   </div>
                   <div className="w-1/3 space-y-2">
                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Время</label>
                    <input type="time" value={newRide.time} onChange={(e) => setNewRide({...newRide, time: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors text-center" />
                   </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">{newRide.direction === 'to_city' ? 'Куда едем? (Район/Улица)' : 'Откуда выезжаем? (Район/Улица)'}</label>
                  <div className="relative">
                      <MapPin size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                      <input type="text" placeholder={newRide.direction === 'to_city' ? "Например: ТЦ Мир, Горсовет..." : "Например: Институт, Общежитие..."} value={newRide.destination} onChange={(e) => setNewRide({...newRide, destination: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 pl-10 pr-4 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors placeholder:text-gray-600" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                   <div className="space-y-2">
                      <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider flex items-center gap-1 h-4">{newRide.isDriver ? 'Цена с пассажира' : 'Цена такси'}</label>
                      <div className="relative h-[46px]">
                         <Banknote size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                         <input type="number" placeholder={newRide.isDriver ? "Цена" : "Общая"} value={newRide.price} onChange={(e) => setNewRide({...newRide, price: e.target.value})} className="w-full h-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-2 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors placeholder:text-gray-600" />
                      </div>
                   </div>
                   <div className="space-y-2">
                      <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider h-4">Свободные места</label>
                      <div className="flex bg-gray-800 p-1 rounded-xl border border-gray-700 h-[46px]">
                        {(newRide.isDriver ? [1, 2, 3, 4] : [1, 2, 3]).map(num => (
                          <button key={num} onClick={() => setNewRide({...newRide, seatsTotal: num})} className={`flex-1 rounded-lg text-sm font-bold transition-all ${newRide.seatsTotal === num ? 'bg-gray-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}>{num}</button>
                        ))}
                      </div>
                   </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Комментарий к поездке</label>
                  <div className="relative">
                      <FileText size={18} className="absolute left-3 top-3 text-gray-500" />
                      <textarea rows="2" placeholder={newRide.isDriver ? "Например: Серебристый Kia Rio, номер 123..." : "Например: Вызываю такси в 18:00..."} value={newRide.comment} onChange={(e) => setNewRide({...newRide, comment: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 pl-10 pr-4 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors placeholder:text-gray-600 resize-none" />
                  </div>
                </div>
                <button onClick={handleCreateRide} disabled={isSubmitting} className={`w-full text-white font-bold py-4 rounded-xl shadow-lg active:scale-98 transition-all mt-4 flex items-center justify-center gap-2 ${newRide.isDriver ? 'bg-yellow-600 hover:bg-yellow-500 shadow-yellow-500/20' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/20'} disabled:bg-gray-700 disabled:text-gray-500`}>
                  {isSubmitting ? <Loader2 className="animate-spin" /> : (newRide.isDriver ? 'Опубликовать как Водитель' : 'Найти попутчиков')}
                </button>
              </div>
            </div>
        )}

        {/* ПРОФИЛЬ */}
        {activeTab === 'profile' && (
            <div className="animate-fade-in space-y-8 pt-4">
               <div className="flex items-center gap-4 bg-gray-800 p-5 rounded-2xl border border-gray-700 shadow-sm relative overflow-hidden">
                 <div className="absolute top-0 right-0 p-3 opacity-10 text-white"><User size={64} /></div>
                 <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-xl font-bold shadow-inner border-2 border-gray-700">{USER_INFO.name[0]}</div>
                 <div><h2 className="text-lg font-bold text-white leading-tight">{USER_INFO.name}</h2><div className="text-gray-400 text-xs mt-1 bg-gray-900/50 inline-block px-2 py-0.5 rounded">ID: {USER_INFO.id}</div></div>
               </div>

               <div>
                  <h3 className="text-gray-400 text-[10px] font-bold uppercase mb-3 tracking-wider flex items-center gap-2">Мои поездки (Я пассажир)</h3>
                  {myPassengerRides.length === 0 ? <div className="text-gray-500 text-xs bg-gray-800/50 border border-gray-700/50 border-dashed p-4 rounded-xl text-center">Вы еще не откликались на поездки</div> : (
                     <div className="space-y-3">
                        {myPassengerRides.map(ride => {
                            const myReq = ride.requests.find(r => r.userId === USER_INFO.id);
                            const status = myReq?.status || 'unknown';
                            const priceDisplay = getPriceDisplay(ride);
                            let statusConfig = { text: '?', color: 'text-gray-500', bg: 'bg-gray-500/10' };
                            if (status === 'pending') statusConfig = { text: 'Ожидание', color: 'text-yellow-500', bg: 'bg-yellow-500/10' };
                            if (status === 'approved') statusConfig = { text: 'Принято', color: 'text-green-500', bg: 'bg-green-500/10' };
                            if (status === 'rejected') statusConfig = { text: 'Отклонено', color: 'text-red-500', bg: 'bg-red-500/10' };

                            return (
                                <div key={ride.id} className="bg-gray-800 border border-gray-700 rounded-xl p-3 flex justify-between items-center shadow-sm">
                                   <div>
                                      <div className="font-bold text-sm text-gray-200">{ride.time} <span className="text-gray-500 font-normal">→ {ride.destination}</span></div>
                                      <div className="text-[10px] text-gray-500 mt-0.5">{formatDate(ride.date)}{priceDisplay && <span className="ml-2 text-green-400">{priceDisplay}</span>}</div>
                                   </div>
                                   <div className="flex items-center gap-2">
                                       <button onClick={() => setActiveChatRide(ride)} className="p-2 text-blue-400 hover:text-white bg-gray-700/50 rounded-lg"><MessageCircle size={14} /></button>
                                       <button onClick={() => handleCancelRequest(ride)} className="p-2 text-red-400 hover:text-white bg-red-500/10 hover:bg-red-500 rounded-lg transition"><LogOut size={14} /></button>
                                       <div className={`px-2 py-1 rounded-md text-[10px] font-bold border border-transparent ${statusConfig.bg} ${statusConfig.color}`}>{statusConfig.text}</div>
                                   </div>
                                </div>
                            );
                        })}
                     </div>
                  )}
               </div>

               <div>
                 <h3 className="text-gray-400 text-[10px] font-bold uppercase mb-3 tracking-wider flex items-center gap-2">Созданные мной {incomingRequestsCount > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full animate-pulse">{incomingRequestsCount}</span>}</h3>
                 
                 {rides.filter(r => r.authorId === USER_INFO.id).length === 0 ? <div className="text-gray-500 text-xs bg-gray-800/50 border border-gray-700/50 border-dashed p-6 rounded-xl text-center">Вы пока не создавали поездок</div> : (
                    <div className="space-y-4">
                      {rides.filter(r => r.authorId === USER_INFO.id).map(ride => (
                        <div key={ride.id} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-sm">
                          <div className="p-3 bg-gray-750 flex justify-between items-center border-b border-gray-700">
                             <div>
                                <div className="font-bold text-sm flex items-center gap-2">
                                    <span className={ride.direction === 'to_city' ? 'text-blue-400' : 'text-green-400'}>{ride.direction === 'to_city' ? 'В ГОРОД' : 'В УФИЦ'}</span>
                                    {ride.isDriver && <span className="text-[10px] bg-yellow-600/20 text-yellow-500 px-1.5 py-0.5 rounded border border-yellow-600/30">Водитель</span>}
                                    <span className="text-gray-600">•</span>
                                    {ride.time}
                                </div>
                                <div className="text-xs text-gray-400 mt-0.5">{formatDate(ride.date)} • {ride.destination}</div>
                             </div>
                             <div className="flex gap-2">
                                 <button onClick={() => setEditingRide(ride)} className="p-2 text-blue-400 hover:text-white bg-gray-700/50 rounded-lg"><Edit size={16} /></button>
                                 <button onClick={() => setActiveChatRide(ride)} className="p-2 text-blue-400 hover:text-white bg-gray-700/50 rounded-lg"><MessageCircle size={16} /></button>
                                 <button onClick={() => handleDeleteRide(ride.id)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"><Trash2 size={16} /></button>
                             </div>
                          </div>
                          
                          <div className="p-3 space-y-2">
                             {(!ride.requests || ride.requests.length === 0) && <div className="text-xs text-gray-500 italic py-1 pl-1">Заявок пока нет</div>}
                             {(ride.requests || []).map((req, idx) => (
                               <div key={idx} className="flex justify-between items-center bg-gray-900/50 p-2.5 rounded-lg border border-gray-700/30">
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-gray-200">{req.name}</span>
                                        {req.telegram && <a href={`https://t.me/${req.telegram}`} className="text-blue-500 opacity-70 hover:opacity-100"><MessageCircle size={12}/></a>}
                                    </div>
                                    <div className="text-[10px] mt-0.5 flex items-center gap-1">
                                       {req.status === 'pending' && <span className="text-yellow-500">Ожидает решения</span>}
                                       {req.status === 'approved' && <span className="text-green-500">Принят</span>}
                                       {req.status === 'rejected' && <span className="text-red-500">Отклонен</span>}
                                    </div>
                                  </div>
                                  {req.status === 'pending' && (
                                    <div className="flex gap-2">
                                      <button onClick={() => handleAcceptRequest(ride.id, req.userId)} disabled={isSubmitting || ride.seatsTaken >= ride.seatsTotal} className="p-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 disabled:opacity-30 disabled:cursor-not-allowed"><Check size={16} /></button>
                                      <button onClick={() => handleRejectRequest(ride, req.userId)} disabled={isSubmitting} className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30"><X size={16} /></button>
                                    </div>
                                  )}
                                  {req.status === 'approved' && (
                                      <button onClick={() => handleRejectRequest(ride, req.userId)} className="text-[10px] text-red-400 underline hover:text-red-300">Исключить</button>
                                  )}
                               </div>
                             ))}
                          </div>
                          <div className="bg-gray-900/30 px-3 py-2 text-[10px] text-gray-500 border-t border-gray-700/50 flex justify-between"><span>Мест занято: {ride.seatsTaken} из {ride.seatsTotal}</span></div>
                        </div>
                      ))}
                    </div>
                 )}
               </div>
            </div>
        )}
      </main>

      {/* --- НИЖНЯЯ ПАНЕЛЬ НАВИГАЦИИ --- */}
      <div className="fixed bottom-0 left-0 w-full bg-gray-900/95 backdrop-blur-md border-t border-gray-800 pb-safe z-50">
        <div className="flex justify-around items-center p-2">
          <button 
            onClick={() => setActiveTab('list')}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all w-20 ${activeTab === 'list' ? 'text-blue-500 bg-blue-500/10' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Search size={24} />
            <span className="text-[10px] font-bold">Поиск</span>
          </button>

          <button 
            onClick={() => setActiveTab('create')}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all w-20 ${activeTab === 'create' ? 'text-blue-500 bg-blue-500/10' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <PlusCircle size={24} />
            <span className="text-[10px] font-bold">Создать</span>
          </button>

          <button 
            onClick={() => setActiveTab('profile')}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all w-20 ${activeTab === 'profile' ? 'text-blue-500 bg-blue-500/10' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <User size={24} />
            <span className="text-[10px] font-bold">Профиль</span>
          </button>
        </div>
      </div>
    </div>
  );
}