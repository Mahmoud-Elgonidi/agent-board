# دليل نظام Agent Board — توثيق كامل

---

## ما هو النظام؟

**Agent Board** هو نظام تنسيق محلي يعمل على جهاز Mac Mini يتيح لك:

- **رؤية جميع المهام** في لوحة Kanban مرئية في الوقت الفعلي
- **تعيين المهام للوكلاء (Agents)** بنقرة واحدة
- **متابعة تقدم كل مهمة** بشريط تقدم مباشر (0–100%)
- **اكتشاف الوكلاء المتوقفين** تلقائياً وإعادة تشغيلهم
- **معالجة المهام بشكل مستمر** — عندما ينهي وكيل مهمة، يأخذ التالية تلقائياً

---

## مكونات النظام

```
┌─────────────────────────────────────────────────┐
│              Agent Board System                  │
│                                                  │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │  Kanban UI   │◄──►│  Backend (port 3001)  │  │
│  │  port 5173   │    │  Express + WebSocket  │  │
│  └──────────────┘    └──────────┬────────────┘  │
│                                 │                │
│                    ┌────────────▼────────────┐   │
│                    │  SQLite DB              │   │
│                    │  ~/.orchestrator/       │   │
│                    │  db.sqlite              │   │
│                    └─────────────────────────┘   │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Doc     │  │ Agent 2  │  │ Agent 3  │  ...  │
│  │ port4001 │  │ port4002 │  │ port4003 │       │
│  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────┘
```

| المكون | الوظيفة | العنوان |
|---|---|---|
| واجهة المستخدم (UI) | لوحة Kanban تفاعلية | http://localhost:5173 |
| الخادم الخلفي (Backend) | API + WebSocket | http://localhost:3001 |
| قاعدة البيانات | SQLite محلية | `~/.orchestrator/db.sqlite` |
| مراقب النبضات | يكتشف الوكلاء المتوقفين | يعمل كل 30 ثانية |

---

## تشغيل النظام

### التشغيل اليدوي
```bash
cd /Users/progmatech/Public/workspace/agent-board
npm run dev
```

### التشغيل التلقائي عند بدء الجهاز (launchd)
```bash
# نسخ ملف الإعداد
cp launchd/com.agentboard.orchestrator.plist ~/Library/LaunchAgents/

# تفعيل الخدمة
launchctl load ~/Library/LaunchAgents/com.agentboard.orchestrator.plist

# التحقق أنها تعمل
launchctl list | grep agentboard
```

---

## أعمدة لوحة Kanban

| العمود | المعنى | اللون |
|---|---|---|
| **Todo** | مهام في الانتظار، لم تُعيَّن بعد | رمادي |
| **In Progress** | مهمة يعمل عليها وكيل الآن | أزرق |
| **Blocked** | توقف الوكيل، يتم إعادة المحاولة | برتقالي |
| **Done** | اكتملت المهمة | أخضر |

---

## كيفية إضافة وكيل حقيقي

### الطريقة الأولى — من واجهة المستخدم

1. افتح http://localhost:5173
2. في الشريط الجانبي الأيمن، انقر **+** بجوار "Agents"
3. أدخل:
   - **الاسم**: مثلاً `Doc`
   - **Port**: رقم المنفذ الذي يستمع عليه الوكيل (مثلاً `4001`)
   - **CLI Command**: إذا كان الوكيل يعمل بأوامر سطر الأوامر (اختياري)
4. انقر **Register**

### الطريقة الثانية — عبر API مباشرة

```bash
curl -X POST http://localhost:3001/api/agents/register \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Doc",
    "host": "localhost",
    "port": 4001,
    "max_idle_seconds": 180
  }'
```

### تعديل بيانات وكيل موجود

```bash
# أولاً احصل على ID الوكيل
curl http://localhost:3001/api/agents

# ثم حدّث البيانات
curl -X PATCH http://localhost:3001/api/agents/AGENT_ID \
  -H 'Content-Type: application/json' \
  -d '{"name": "Doc - Main", "port": 4001}'
```

---

## كيفية إنشاء مهمة وتعيينها

### إنشاء مهمة

**من الواجهة:**
1. انقر زر **New Task** (أعلى يمين)
2. أدخل: العنوان، الوصف، الأولوية
3. انقر **Create Task** — تظهر في عمود Todo

**عبر API:**
```bash
curl -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "كتابة توثيق API",
    "description": "توثيق جميع endpoints مع أمثلة",
    "priority": "high"
  }'
```

مستويات الأولوية: `low` | `medium` | `high` | `urgent`

### تعيين مهمة لوكيل

**من الواجهة:**
1. مرّر على بطاقة المهمة
2. انقر أيقونة الشخص (👤) في أعلى يمين البطاقة
3. اختر الوكيل من القائمة
4. انقر **Assign & Start**
5. المهمة تنتقل تلقائياً إلى **In Progress**

**عبر API:**
```bash
curl -X POST http://localhost:3001/api/tasks/TASK_ID/assign \
  -H 'Content-Type: application/json' \
  -d '{"agentId": "AGENT_ID"}'
```

---

## ربط الوكيل الحقيقي بالنظام

هذا هو الجزء الأهم — كيف يُبلّغ الوكيل عن حالته الفعلية.

### الطريقة 1 — الوكيل يرسل نبضات (Heartbeat) — الأفضل

الوكيل يستدعي هذا الـ endpoint كلما تقدم في المهمة:

```bash
# عند بدء المهمة (progress = 0)
curl -X POST http://localhost:3001/api/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId": "AGENT_ID",
    "taskId": "TASK_ID",
    "progress": 0,
    "status": "running",
    "message": "بدأت العمل على المهمة"
  }'

# في منتصف المهمة (progress = 50)
curl -X POST http://localhost:3001/api/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId": "AGENT_ID",
    "taskId": "TASK_ID",
    "progress": 50,
    "status": "running",
    "message": "اكتمل النصف الأول"
  }'

# عند الانتهاء — المهمة تنتقل تلقائياً إلى Done
curl -X POST http://localhost:3001/api/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId": "AGENT_ID",
    "taskId": "TASK_ID",
    "progress": 100,
    "status": "completed",
    "message": "اكتملت المهمة بنجاح"
  }'
```

قيم `status` المتاحة:

| القيمة | المعنى |
|---|---|
| `running` | الوكيل يعمل بشكل طبيعي |
| `completed` | انتهت المهمة — تنتقل إلى Done تلقائياً |
| `failed` | فشلت المهمة |
| `blocked` | الوكيل متوقف مؤقتاً |

### الطريقة 2 — استخدام SDK (لوكلاء Node.js)

```js
const { report, complete, fail } = require('/path/to/sdk/orchestrator-sdk')

// في بداية المهمة
await report({
  agentId: 'AGENT_ID',
  taskId: 'TASK_ID',
  progress: 0,
  message: 'بدأت'
})

// أثناء العمل
await report({
  agentId: 'AGENT_ID',
  taskId: 'TASK_ID',
  progress: 60,
  message: 'جارٍ تشغيل الاختبارات'
})

// عند الانتهاء
await complete({
  agentId: 'AGENT_ID',
  taskId: 'TASK_ID',
  message: 'تم بنجاح'
})

// عند الفشل
await fail({
  agentId: 'AGENT_ID',
  taskId: 'TASK_ID',
  message: 'خطأ في الاتصال'
})
```

متغيرات البيئة للـ SDK:
```bash
ORCHESTRATOR_HOST=localhost
ORCHESTRATOR_PORT=3001
```

---

## متابعة المهام ومراقتبها

### من واجهة المستخدم

كل بطاقة مهمة تُظهر:

```
┌─────────────────────────────────┐
│ 🔴 high          [👤] [🗑]      │  ← الأولوية + أزرار
│                                 │
│ كتابة توثيق API                 │  ← عنوان المهمة
│ توثيق جميع endpoints مع أمثلة  │  ← الوصف
│                                 │
│ التقدم            60%           │
│ ████████████░░░░░               │  ← شريط التقدم
│                                 │
│ 🟢 Doc          🕐 2m ago       │  ← الوكيل + آخر نبضة
└─────────────────────────────────┘
```

### من API

```bash
# جميع المهام مع حالاتها
curl http://localhost:3001/api/tasks

# جميع الوكلاء مع حالاتهم
curl http://localhost:3001/api/agents

# سجل الأحداث (آخر 200 حدث)
curl http://localhost:3001/api/events

# أحداث وكيل معين
curl http://localhost:3001/api/agents/AGENT_ID/logs

# أحداث مهمة معينة
curl http://localhost:3001/api/tasks/TASK_ID/events
```

### WebSocket — التحديثات الفورية

النظام يرسل هذه الأحداث تلقائياً للواجهة:

| الحدث | المعنى |
|---|---|
| `task:created` | مهمة جديدة أُضيفت |
| `task:updated` | تغيّرت حالة المهمة أو تقدمها |
| `task:deleted` | حُذفت المهمة |
| `agent:heartbeat` | وكيل أرسل نبضة حياة |
| `agent:updated` | تغيّرت حالة الوكيل |
| `agent:stuck` | وكيل متوقف — لم يرسل نبضة منذ 3 دقائق |
| `agent:resumed` | تمت إعادة تشغيل الوكيل تلقائياً |

---

## حالات الوكيل في الشريط الجانبي

| الحالة | اللون | المعنى |
|---|---|---|
| **idle** | 🟢 أخضر | الوكيل متاح ولا يعمل على شيء |
| **busy** | 🔵 أزرق يومض | الوكيل يعمل على مهمة |
| **stuck** | 🟠 برتقالي يومض | لم يرسل نبضة منذ أكثر من 3 دقائق |
| **offline** | ⚫ رمادي | الوكيل غير متصل |

---

## منطق اكتشاف الوكيل المتوقف (Stuck Detection)

كل 30 ثانية يتحقق النظام:

```
إذا (الوقت_الحالي - آخر_نبضة > max_idle_seconds):
    → تغيير حالة الوكيل إلى "stuck"
    → إرسال أمر resume للوكيل
    → تسجيل الحدث في قاعدة البيانات
    → إشعار الواجهة فوراً
```

- القيمة الافتراضية: **180 ثانية (3 دقائق)**
- يمكن تغييرها لكل وكيل بشكل مستقل عبر `max_idle_seconds`

---

## المعالجة المستمرة للمهام (Auto Queue)

عندما يُبلّغ وكيل عن اكتمال مهمة:

```
1. المهمة تنتقل إلى Done تلقائياً
2. الوكيل يصبح idle
3. النظام يبحث في قائمة Todo
4. يختار المهمة الأعلى أولوية
5. يعيّنها للوكيل تلقائياً
6. الواجهة تتحدث فوراً
```

لا يحتاج أي تدخل يدوي.

---

## إعداد ملف الوكلاء (agents.config.json)

```json
{
  "agents": [
    {
      "id": "doc-agent",
      "name": "Doc",
      "type": "openclaw",
      "host": "localhost",
      "port": 4001,
      "cli_command": null,
      "max_idle_seconds": 180,
      "description": "وكيل التوثيق الرئيسي"
    },
    {
      "id": "agent-2",
      "name": "Agent 2",
      "type": "openclaw",
      "host": "localhost",
      "port": 4002,
      "max_idle_seconds": 180
    }
  ]
}
```

---

## ملف الإعدادات (.env)

```env
BACKEND_PORT=3001          # منفذ الخادم الخلفي
FRONTEND_PORT=5173         # منفذ الواجهة
DB_PATH=~/.orchestrator/db.sqlite   # مسار قاعدة البيانات
HEARTBEAT_INTERVAL_MS=30000         # فترة فحص النبضات (30 ثانية)
STUCK_THRESHOLD_SECONDS=180         # وقت اعتبار الوكيل متوقفاً (3 دقائق)
```

---

## سيناريو كامل — من البداية للنهاية

```
1. تشغيل النظام
   $ npm run dev

2. فتح http://localhost:5173

3. إضافة وكيل Doc من الشريط الجانبي (+)
   الاسم: Doc | Port: 4001

4. إنشاء مهمة (New Task)
   العنوان: "كتابة توثيق API"
   الأولوية: high

5. تعيين المهمة لـ Doc
   مرر على البطاقة → أيقونة 👤 → اختر Doc → Assign & Start

6. الوكيل يبدأ العمل ويرسل نبضات:
   POST /api/heartbeat { progress: 20, status: "running" }
   POST /api/heartbeat { progress: 60, status: "running" }
   POST /api/heartbeat { progress: 100, status: "completed" }

7. المهمة تنتقل تلقائياً إلى Done
   الوكيل يصبح idle
   المهمة التالية تُعيَّن تلقائياً
```

---

## أوامر مفيدة للاختبار

```bash
# إرسال نبضة اختبارية
curl -X POST http://localhost:3001/api/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"AGENT_ID","taskId":"TASK_ID","progress":45,"status":"running","message":"اختبار"}'

# نقل مهمة يدوياً إلى Done
curl -X PATCH http://localhost:3001/api/tasks/TASK_ID \
  -H 'Content-Type: application/json' \
  -d '{"status":"done","progress":100}'

# تغيير حالة وكيل إلى idle
curl -X PATCH http://localhost:3001/api/agents/AGENT_ID \
  -H 'Content-Type: application/json' \
  -d '{"status":"idle","clearTask":true}'

# حذف مهمة
curl -X DELETE http://localhost:3001/api/tasks/TASK_ID

# عرض سجل الأحداث
curl http://localhost:3001/api/events | python3 -m json.tool
```

---

## الأسئلة الشائعة

**س: الوكيل لا يرسل نبضات — كيف أعرف إذا بدأ يعمل؟**
ج: إذا لم يتغير شريط التقدم بعد 3 دقائق، سيظهر الوكيل باللون البرتقالي (stuck) وسيحاول النظام إعادة تشغيله تلقائياً.

**س: كيف أغير وقت اعتبار الوكيل متوقفاً؟**
ج: عدّل `max_idle_seconds` في إعدادات الوكيل:
```bash
curl -X PATCH http://localhost:3001/api/agents/AGENT_ID \
  -H 'Content-Type: application/json' \
  -d '{"max_idle_seconds": 300}'
```

**س: هل يمكن تشغيل الوكلاء على أجهزة مختلفة؟**
ج: نعم، غيّر `host` عند تسجيل الوكيل:
```bash
-d '{"name":"Remote Agent","host":"192.168.1.50","port":4001}'
```

**س: أين تُخزَّن البيانات؟**
ج: في `~/.orchestrator/db.sqlite` — تبقى محفوظة عند إعادة تشغيل الجهاز.
