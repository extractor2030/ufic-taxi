import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  collectionGroup, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  updateDoc, 
  doc, 
  getDoc, 
  getDocs 
} from "firebase/firestore";
import { Terminal, Play, Square, Save, Trash2, Bell, AlertTriangle } from 'lucide-react';

export default function BotDashboard({ db, onClose }) {
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