import React, { useState, useEffect, useRef } from 'react';
import { collection, collectionGroup, query, where, orderBy, onSnapshot, updateDoc, doc, getDoc } from "firebase/firestore";
import { Terminal, Play, Square, Save, Trash2, Bell } from 'lucide-react';

export default function BotDashboard({ db, onClose }) {
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  // Токен храним в localStorage, чтобы не вводить каждый раз. По умолчанию используем ваш токен.
  const [token, setToken] = useState(localStorage.getItem('bot_token') || '7275058311:AAGUfoC3ng1ldEDpD1JqMyoPReYw715CIn0');
  
  const ridesCache = useRef({});
  const unsubscribers = useRef([]);

  const addLog = (text, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${text}`, ...prev].slice(0, 50)); // Храним последние 50 логов
  };

  const saveToken = () => {
    localStorage.setItem('bot_token', token);
    addLog("Токен сохранен в браузере", 'success');
  };

  const sendTelegramMessage = async (chatId, text) => {
    if (!chatId || !token) return;
    try {
      addLog(`📤 Отправка сообщения ID: ${chatId}...`);
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
      if (data.ok) addLog(`✅ Доставлено ID: ${chatId}`, 'success');
      else addLog(`❌ Ошибка Telegram: ${data.description}`, 'error');
    } catch (error) {
      addLog(`❌ Ошибка сети: ${error.message}`, 'error');
    }
  };

  const startBot = () => {
    if (!token) return alert("Введите токен бота!");
    setIsRunning(true);
    addLog("🚀 Бот запущен! Слушаю события...");

    // 1. СЛУШАЕМ СООБЩЕНИЯ
    const botStartTime = new Date();
    // Фильтруем сообщения, созданные ПОСЛЕ запуска бота
    const qMessages = query(
        collectionGroup(db, 'messages'), 
        where('createdAt', '>', botStartTime),
        orderBy('createdAt', 'asc')
    );

    const unsubMsg = onSnapshot(qMessages, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
                const msg = change.doc.data();
                if (msg.senderId === 'system') return;
                
                addLog(`📝 Новое сообщение от ${msg.senderName}`);
                
                // Получаем ID поездки через ref родительского документа
                const rideRef = change.doc.ref.parent.parent;
                if (!rideRef) return;

                const rideSnap = await getDoc(rideRef);
                if (!rideSnap.exists()) return;

                const ride = rideSnap.data();
                const recipients = new Set();
                
                // Добавляем автора поездки
                if (ride.authorId !== msg.senderId) recipients.add(ride.authorId);
                
                // Добавляем принятых пассажиров
                if (ride.requests) {
                    ride.requests.forEach(r => {
                        if (r.status === 'approved' && r.userId !== msg.senderId) recipients.add(r.userId);
                    });
                }
                
                const text = `💬 <b>Новое сообщение</b>\nОт: ${msg.senderName}\n"${msg.text}"`;
                recipients.forEach(id => sendTelegramMessage(id, text));
            }
        });
    }, (error) => addLog(`Ошибка Messages: ${error.message}`, 'error'));

    // 2. СЛУШАЕМ ЗАЯВКИ И ИХ СТАТУСЫ
    const qRides = query(collection(db, 'rides'));
    const unsubRides = onSnapshot(qRides, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const rideData = change.doc.data();
            const rideId = change.doc.id;
            
            // Если поездка только загрузилась, просто кэшируем её текущее состояние
            if (change.type === 'added') {
                ridesCache.current[rideId] = rideData.requests || [];
            }
            
            // Если поездка изменилась (кто-то добавился или сменил статус)
            if (change.type === 'modified') {
                const oldRequests = ridesCache.current[rideId] || [];
                const newRequests = rideData.requests || [];

                newRequests.forEach(req => {
                    const oldReq = oldRequests.find(r => r.userId === req.userId);
                    
                    // СЦЕНАРИЙ А: НОВАЯ ЗАЯВКА (в старом кэше её не было)
                    if (!oldReq) {
                        addLog(`🆕 Новая заявка: ${req.name}`);
                        sendTelegramMessage(rideData.authorId, 
                            `🙋‍♂️ <b>Новая заявка!</b>\n\n${req.name} хочет поехать с вами в ${rideData.time}.\nЗайдите в приложение.`);
                    }
                    // СЦЕНАРИЙ Б: ИЗМЕНЕНИЕ СТАТУСА (заявка была, статус другой)
                    else if (oldReq.status !== req.status) {
                        addLog(`🔄 Смена статуса (${req.name}): ${req.status}`);
                        if (req.status === 'approved') {
                            sendTelegramMessage(req.userId, `✅ <b>Заявка принята!</b>\nПоездка в ${rideData.time}.`);
                        } else if (req.status === 'rejected') {
                            sendTelegramMessage(req.userId, `❌ <b>Заявка отклонена</b>\nВодитель отказал.`);
                        }
                    }
                });
                // Обновляем кэш
                ridesCache.current[rideId] = newRequests;
            }
            if (change.type === 'removed') delete ridesCache.current[rideId];
        });
    }, (error) => addLog(`Ошибка Rides: ${error.message}`, 'error'));

    // 3. ТАЙМЕР НАПОМИНАНИЙ (Раз в минуту)
    const checkReminders = async () => {
         const now = new Date();
         const targetTime = new Date(now.getTime() + 15 * 60000); // +15 мин
         const timeStr = targetTime.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'});
         const dateStr = now.toISOString().split('T')[0];

         // Ищем поездки на сегодня
         const qToday = query(collection(db, 'rides'), where('date', '==', dateStr));
         
         const unsubRemind = onSnapshot(qToday, (snap) => {
             snap.docs.forEach(async d => {
                 const r = d.data();
                 // Проверяем совпадение времени и что еще не напоминали
                 if (r.time === timeStr && !r.reminded) {
                     addLog(`🔔 Напоминание: ${r.destination}`);
                     
                     const recipients = new Set();
                     recipients.add(r.authorId);
                     if (r.requests) {
                        r.requests.forEach(req => {
                            if(req.status==='approved') recipients.add(req.userId);
                        });
                     }
                     
                     recipients.forEach(id => sendTelegramMessage(id, `⏰ <b>Напоминание!</b>\nПоездка через 15 мин в ${r.destination}`));
                     
                     // Ставим метку, что напомнили
                     try { 
                        await updateDoc(doc(db, 'rides', d.id), { reminded: true }); 
                     } catch(e) { 
                        addLog("Ошибка записи reminded", 'error'); 
                     }
                 }
             });
             // Сразу отписываемся, это была разовая проверка
             unsubRemind(); 
         });
    };

    // Запускаем проверку каждую минуту
    const timerInterval = setInterval(checkReminders, 60000);

    unsubscribers.current = [unsubMsg, unsubRides, () => clearInterval(timerInterval)];
  };

  const stopBot = () => {
    unsubscribers.current.forEach(u => u());
    unsubscribers.current = [];
    setIsRunning(false);
    addLog("🛑 Бот остановлен.");
  };

  return (
    <div className="fixed inset-0 z-[100] bg-gray-900 text-white flex flex-col font-mono text-sm animate-fade-in">
      {/* HEADER */}
      <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center shadow-lg shrink-0">
        <div className="flex items-center gap-3">
            <Terminal className="text-green-400" />
            <div>
                <h2 className="font-bold text-lg">Панель Управления Ботом</h2>
                <div className="text-xs text-gray-400">Держите эту вкладку открытой для работы бота</div>
            </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white px-3 py-1 rounded hover:bg-gray-700">Закрыть</button>
      </div>

      {/* CONTROLS */}
      <div className="p-4 bg-gray-800/50 flex flex-col md:flex-row gap-4 border-b border-gray-700 shrink-0">
        <div className="flex-1 flex gap-2">
            <input 
                type="text" 
                value={token} 
                onChange={(e) => setToken(e.target.value)} 
                placeholder="Токен бота (12345:AAA...)"
                className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:border-blue-500 outline-none"
            />
            <button onClick={saveToken} className="p-2 bg-gray-700 rounded hover:bg-gray-600 text-gray-300" title="Сохранить токен"><Save size={20}/></button>
        </div>
        <div className="flex gap-2">
            {!isRunning ? (
                <button onClick={startBot} className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-500 rounded font-bold shadow-lg shadow-green-900/20 transition-all active:scale-95 text-white">
                    <Play size={18} /> ЗАПУСТИТЬ
                </button>
            ) : (
                <button onClick={stopBot} className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-500 rounded font-bold shadow-lg shadow-red-900/20 transition-all active:scale-95 animate-pulse text-white">
                    <Square size={18} /> ОСТАНОВИТЬ
                </button>
            )}
            <button onClick={() => setLogs([])} className="p-2 bg-gray-700 rounded hover:bg-gray-600 text-gray-400" title="Очистить лог"><Trash2 size={20}/></button>
        </div>
      </div>

      {/* LOGS */}
      <div className="flex-1 bg-black p-4 overflow-y-auto font-mono text-xs md:text-sm space-y-1">
        {logs.length === 0 && <div className="text-gray-600 text-center mt-10">Журнал событий пуст... Нажмите "Запустить"</div>}
        {logs.map((log, i) => (
            <div key={i} className={`border-l-2 pl-2 break-all ${
                log.includes('❌') ? 'border-red-500 text-red-400' : 
                log.includes('✅') ? 'border-green-500 text-green-400' : 
                log.includes('📝') ? 'border-blue-500 text-blue-300' : 
                log.includes('🆕') ? 'border-yellow-500 text-yellow-300' : 
                'border-gray-700 text-gray-300'
            }`}>
                {log}
            </div>
        ))}
      </div>
    </div>
  );
}