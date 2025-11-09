import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, addDoc, collection, query, where, orderBy, limit, serverTimestamp, getDocs } from 'firebase/firestore'; // Cleaned up imports
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { Home, Beaker, History, Zap, ZapOff, Wifi, Play, Save, Loader2, Database, AlertCircle, CheckCircle, Sparkles, Upload, XCircle, Droplets, Leaf, FlaskConical, Edit3, Map, Send, User, Bot } from 'lucide-react'; // Added Send, User, Bot

// --- Firebase Configuration ---
// These variables are (and must be) defined in the global scope by the host environment.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// ******************************************************************
// *** FINAL FIX: HARDCODED KEY TO BYPASS RENDER ENV VARIABLE ISSUES ***
// ******************************************************************
const firebaseConfig = {
  apiKey: "AIzaSyAKsju4i7rTicmHE4PXGmCr0wKPqzaCH4A", // YOUR API KEY
  authDomain: "eis-dashboard-72f97.firebaseapp.com",
  projectId: "eis-dashboard-72f97",
  storageBucket: "eis-dashboard-72f97.firebasestorage.app",
  messagingSenderId: "357594303691",
  appId: "1:357594303691:web:d7e40beb40aa64b5891f4e",
  measurementId: "G-FHC7K8XE36"
};
// ******************************************************************

// Removed initialAuthToken reference as it causes custom-token-mismatch
const initialAuthToken = undefined; 

// --- Gemini API Configuration ---
const GEMINI_API_KEY = ""; // Leave blank!
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

// --- Firebase Initialization ---
let app, auth, db;
try {
  // We no longer check the fallback, as the config is hardcoded.
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error("Firebase initialization error:", e);
}

// --- Firebase Paths (Our "Mailbox") ---
const DEVICE_COLLECTION = 'eis-device';
const STATE_DOC = 'state';
const LIVE_RESULTS_DOC = 'live-results';
const LIVE_RESULTS_COLLECTION = 'points';
const HISTORY_COLLECTION = 'eis_history';

// =================================================================================
// == Utility & Helper Components (Moved to top for hoisting)
// =================================================================================

/**
 * == Utility: NavButton ==
 */
function NavButton({ text, icon, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-lg
        transition-colors duration-200
        ${active ? 'bg-cyan-800 text-white shadow-inner' : 'text-gray-300 hover:bg-gray-800'}
      `}
    >
      {icon}
      <span>{text}</span>
    </button>
  );
}

/**
 * == Utility: Button ==
 */
function Button({ text, icon, onClick, disabled, className = '', type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`
        flex items-center justify-center space-x-2 px-4 py-2 rounded-lg font-semibold
        transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-400
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
    >
      {disabled && <Loader2 className="animate-spin h-5 w-5" />}
      {!disabled && icon}
      <span>{text}</span>
    </button>
  );
}

/**
 * == Utility: DeviceStatusIndicator ==
 */
function DeviceStatusIndicator({ status }) {
  // Check if heartbeat is a Firebase Timestamp and convert it
  const heartbeatSeconds = status.heartbeat?.seconds ? status.heartbeat.seconds : 0;
  const isOnline = (Date.now() / 1000 - heartbeatSeconds) < 15; // 15 sec timeout
  const color = isOnline ? 'bg-green-500' : 'bg-red-500';
  const text = isOnline ? 'Device Online' : 'Device Offline';

  return (
    <div className="bg-gray-800 p-3 rounded-lg">
      <div className="flex items-center mb-2">
        <span className={`w-3 h-3 rounded-full ${color} mr-2`}></span>
        <span className="text-sm font-semibold">{text}</span>
      </div>
      <p className="text-xs text-gray-400 font-mono break-words">{status.message || "..."}</p>
    </div>
  );
}

/**
 * == Utility: CustomTooltip (for Charts) ==
 */
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-gray-900 bg-opacity-90 p-3 rounded-lg border border-gray-700 shadow-lg">
        <p className="text-sm text-cyan-300 font-bold">
          {data.freq ? `Freq: ${data.freq.toFixed(0)} Hz` : `Re: ${data.re.toFixed(2)} Ω`}
        </p>
        <ul className="mt-1 space-y-1">
          {data.mag && <li className="text-xs text-green-300">{`Mag: ${data.mag.toFixed(2)} Ω`}</li>}
          {data.phase && <li className="text-xs text-red-300">{`Phase: ${data.phase.toFixed(2)} °`}</li>}
          {data.re && <li className="text-xs text-gray-300">{`Re(Z): ${data.re.toFixed(2)} Ω`}</li>}
          {data.im && <li className="text-xs text-purple-300">{`-Im(Z): ${(-data.im).toFixed(2)} Ω`}</li>}
        </ul>
      </div>
    );
  }
  return null;
};

/**
 * == Utility: ValueAnimator (for Calibration) ==
 */
function ValueAnimator({ value, brief = false }) {
  const [currentValue, setCurrentValue] = useState(value);
  const prevValue = useRef(value);

  useEffect(() => {
    if (value !== prevValue.current) {
      setCurrentValue(value);
      prevValue.current = value;
    }
  }, [value]);

  return (
    <span className={`inline-block ${!brief ? 'text-yellow-300' : 'text-gray-400'} p-1 rounded-sm animate-bounceIn`}>
      {currentValue}
    </span>
  );
}

/**
 * == Utility: AnalysisTypeButton (for AI) ==
 */
function AnalysisTypeButton({ text, icon, active, onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium
        transition-colors duration-200
        ${active ? 'bg-cyan-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      {React.cloneElement(icon, { className: "h-4 w-4" })}
      <span>{text}</span>
    </button>
  );
}

/**
 * == Utility: AnalysisReport (for AI) ==
 */
function AnalysisReport({ report }) {
  if (!report) return null;

  return (
    <div className="space-y-3">
      <h4 className="text-lg font-semibold text-white">{report.report_title}</h4>
      <p className="text-gray-300 whitespace-pre-wrap">{report.summary}</p>
      {report.metrics && report.metrics.length > 0 && (
        <div>
          <h5 className="text-md font-semibold text-gray-400 mb-2">Key Metrics:</h5>
          <div className="grid grid-cols-1 gap-2">
            {report.metrics.map((metric, index) => (
              <div key={index} className="bg-gray-800 p-2 rounded-lg shadow-inner">
                <span className="block text-xs text-gray-400">{metric.name}</span>
                <span className="block text-md font-bold text-white">{metric.value}</span>
                <span className="block text-xs text-gray-500 mt-1">{metric.insight}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * == Utility: ChatBubble (for AI) ==
 */
function ChatBubble({ role, content }) {
  // --- User Message ---
  if (role === 'user') {
    // Don't render the initial huge user prompt
    if (content.includes("Here is the NEW sweep data to analyze:")) return null; 
    
    return (
      <div className="flex justify-end">
        <div className="bg-blue-800 p-3 rounded-lg max-w-lg">
          <div className="flex items-center gap-2 mb-1">
            <User className="h-4 w-4 text-blue-300" />
            <span className="text-sm font-semibold text-blue-200">You</span>
          </div>
          <p className="text-white whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    );
  }

  // --- Model Message (AI) ---
  const isStructuredReport = typeof content === 'object';
  
  return (
    <div className="flex justify-start">
      <div className="bg-gray-900 p-3 rounded-lg max-w-lg border border-gray-700">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="h-4 w-4 text-cyan-300" />
          <span className="text-sm font-semibold text-cyan-300">AI Analyst</span>
        </div>
        {isStructuredReport ? (
          // Render the structured report
          <AnalysisReport report={content} />
        ) : (
          // Render plain text follow-up
          <p className="text-white whitespace-pre-wrap">{content}</p>
        )}
      </div>
    </div>
  );
}

/**
 * == Reusable Plotting Component ==
 * Renders Bode (Mag/Phase) and Nyquist plots for given sweep data.
 */
function BodeNyquistPlots({ sweepData, title }) {
  if (!sweepData || sweepData.length === 0) {
    return (
      <div className="bg-gray-800 p-4 rounded-lg shadow-md">
        <h3 className="text-xl font-semibold text-white mb-4">{title}</h3>
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-400">No sweep data to display.</p>
        </div>
      </div>
    );
  }
  
  // Nyquist data plots -Im vs Re
  const nyquistData = sweepData.map(d => ({ ...d, im: -d.im }));

  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-md space-y-8">
      <h3 className="text-xl font-semibold text-white">{title}</h3>
      
      {/* --- Bode Plots --- */}
      <div>
        <h4 className="text-lg font-semibold text-cyan-300 mb-2">Bode Plot: Magnitude</h4>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={sweepData} margin={{ top: 5, right: 10, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4B5563" />
            <XAxis dataKey="freq" type="number" scale="log" domain={['dataMin', 'dataMax']} tickFormatter={(f) => `${f} Hz`} stroke="#9CA3AF" />
            <YAxis yAxisId="left" type="number" scale="log" domain={['auto', 'auto']} tickFormatter={(z) => `${z} Ω`} stroke="#9CA3AF" />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="mag" stroke="#34D399" name="Magnitude (Ω)" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      <div>
        <h4 className="text-lg font-semibold text-cyan-300 mb-2">Bode Plot: Phase</h4>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={sweepData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4B5563" />
            <XAxis dataKey="freq" type="number" scale="log" domain={['dataMin', 'dataMax']} tickFormatter={(f) => `${f} Hz`} stroke="#9CA3AF" />
            <YAxis yAxisId="left" type="number" domain={[-180, 180]} tickFormatter={(p) => `${p}°`} stroke="#9CA3AF" />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="phase" stroke="#F87171" name="Phase (°)" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* --- Nyquist Plot --- */}
      <div>
        <h4 className="text-lg font-semibold text-cyan-300 mb-2">Nyquist Plot (-Im vs. Re)</h4>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
            <CartesianGrid stroke="#4B5563" />
            <XAxis dataKey="re" type="number" name="Re(Z)" unit=" Ω" stroke="#9CA3AF" domain={['auto', 'auto']} />
            <YAxis dataKey="im" type="number" name="-Im(Z)" unit=" Ω" stroke="#9CA3AF" domain={['auto', 'auto']} />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
            <Legend />
            <Scatter name="Impedance" data={nyquistData} fill="#8B5CF6" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * == Utility: TomographyHeatmap Component ==
 * Renders a simple 2D heatmap from tomo data
 */
function TomographyHeatmap({ data, metric }) {
  if (!data || data.length === 0) return null;

  // Find data bounds
  let minVal = Infinity, maxVal = -Infinity; // --- FIX: maxVal should start at -Infinity
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  
  data.forEach(d => {
    const val = d[metric];
    if (val < minVal) minVal = val;
    if (val > maxVal) maxVal = val;
    if (d.x < minX) minX = d.x;
    if (d.x > maxX) maxX = d.x;
    if (d.y < minY) minY = d.y;
    if (d.y > maxY) maxY = d.y;
  });

  const valRange = maxVal - minVal;
  const xRange = maxX - minX;
  const yRange = maxY - minY;

  // Normalize a value to a 0-1 range
  const normalize = (val) => (valRange > 0) ? (val - minVal) / valRange : 0.5;
  
  // Get color for a value
  const getColor = (val) => {
    const norm = normalize(val);
    // Simple heatmap color scale: blue (low) -> green -> red (high)
    const h = (1.0 - norm) * 240; // 0 (red) to 240 (blue)
    return `hsl(${h}, 100%, 50%)`;
  };

  return (
    <div className="relative w-full aspect-square bg-gray-900 border border-gray-700 rounded-md overflow-hidden">
      {data.map((d, i) => {
        const left = (xRange > 0) ? ((d.x - minX) / xRange) * 100 : 50;
        const top = (yRange > 0) ? ((d.y - minY) / yRange) * 100 : 50;
        const color = getColor(d[metric]);

        return (
          <div
            key={i}
            className="absolute w-4 h-4 rounded-full -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              backgroundColor: color,
              boxShadow: `0 0 8px ${color}`
            }}
            title={`${metric} @ (x:${d.x}, y:${d.y}): ${d[metric].toFixed(2)}`}
          />
        );
      })}
    </div>
  );
}


// =================================================================================
// == Main App & Page Components
// =================================================================================

/**
 * == Main App Component ==
 * This is the root of your application.
 */
export default function App() {
  const [page, setPage] = useState('home');
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // --- Live Data States ---
  const [deviceStatus, setDeviceStatus] = useState({ message: 'Offline', heartbeat: 0 });
  const [liveSweepData, setLiveSweepData] = useState([]);
  const [calCoefficients, setCalCoefficients] = useState({});
  const [uploadedSweepData, setUploadedSweepData] = useState([]);
  // --- NEW: Tomography Data State ---
  const [tomoData, setTomoData] = useState([]);
  
  const [isPapaParseLoaded, setIsPapaParseLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingCommand, setIsSendingCommand] = useState(false);

  // --- Load PapaParse Script ---
  useEffect(() => {
    const scriptId = "papaparse-script";
    if (document.getElementById(scriptId)) {
      setIsPapaParseLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.id = scriptId;
    script.src = "https://unpkg.com/papaparse@5.3.0/papaparse.min.js"; // Switched to unpkg CDN
    script.async = true;
    script.onload = () => {
      setIsPapaParseLoaded(true);
    };
    script.onerror = () => {
      console.error("Failed to load PapaParse script.");
    };
    document.body.appendChild(script);
  }, []);

  // --- Firebase Auth Effect ---
  useEffect(() => {
    if (!auth) {
      console.error("Firebase Auth is not initialized.");
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
      } else if (initialAuthToken) {
        try {
          // REMOVED: await signInWithCustomToken(auth, initialAuthToken); 
          // This causes the persistent custom-token-mismatch error.
          await signInAnonymously(auth); // Use Anonymous login instead
        } catch (e) {
          console.error("Custom token sign-in error:", e);
          await signInAnonymously(auth); // Fallback
        }
      } else {
        await signInAnonymously(auth);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, [auth, initialAuthToken]); // Added dependencies to comply with React Hooks rules

  // --- Firebase Data Listeners ---
  useEffect(() => {
    // Wait until auth is ready AND we have a userId
    if (!isAuthReady || !db || !userId) {
      return;
    }

    setIsLoading(true);
    const listeners = [];

    // --- Build dynamic paths based on user ID ---
    const userRootPath = `artifacts/${appId}/users/${userId}`;
    const stateDocPath = `${userRootPath}/${DEVICE_COLLECTION}/${STATE_DOC}`;
    const resultsColPath = `${userRootPath}/${DEVICE_COLLECTION}/${LIVE_RESULTS_DOC}/${LIVE_RESULTS_COLLECTION}`;

    // 1. Listen for Device Status and Calibration (from the single STATE_DOC)
    try {
      const stateUnsub = onSnapshot(doc(db, stateDocPath), (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          setDeviceStatus(data.status || { message: 'Offline', heartbeat: 0 });
          setCalCoefficients(data.calibration || {});
        } else {
          // Doc doesn't exist, set to default offline state
          setDeviceStatus({ message: 'Offline', heartbeat: 0 });
          setCalCoefficients({});
        }
      });
      listeners.push(stateUnsub);

      // 2. Listen for Live Sweep Results (from the sub-collection)
      const resultsUnsub = onSnapshot(collection(db, resultsColPath), (snapshot) => {
        const data = snapshot.docs.map(doc => {
          const freq = parseFloat(doc.id);
          const { mag, phase } = doc.data();
          const phaseRad = phase * (Math.PI / 180.0);
          return {
            freq,
            mag,
            phase,
            re: mag * Math.cos(phaseRad),
            im: mag * Math.sin(phaseRad)
          };
        });
        // Sort by frequency
        data.sort((a, b) => a.freq - b.freq);
        setLiveSweepData(data);
      });
      listeners.push(resultsUnsub);

    } catch (e) {
      console.error("Error setting up Firebase listeners:", e);
    }

    setIsLoading(false);

    // Detach all listeners on cleanup
    return () => {
      listeners.forEach(unsub => unsub());
    };
  }, [isAuthReady, userId]); // Re-run if auth or user changes

  // --- Helper Functions ---

  /**
   * Sends a command to the Arduino via Firebase
   * @param {string} commandName e.g., "RUN_SWEEP"
   * @param {object} payload Additional data for the command
   */
  const sendDeviceCommand = async (commandName, payload = {}) => {
    if (!db || !userId) {
      alert("Not connected to Firebase or user not authenticated.");
      return;
    }
    setIsSendingCommand(true);

    // Build the path to the state document for this user
    const stateDocPath = `artifacts/${appId}/users/${userId}/${DEVICE_COLLECTION}/${STATE_DOC}`;

    try {
      // Update the 'command' field in the state document
      await setDoc(doc(db, stateDocPath), {
        command: {
          name: commandName,
          ...payload,
          timestamp: serverTimestamp(), // Use server timestamp
        }
      }, { merge: true }); // { merge: true } is crucial here
    } catch (e) {
      console.error("Error sending command:", e);
      alert("Error sending command: " + e.message);
    }
    setIsSendingCommand(false);
  };
  
  // NOTE: saveSweepToHistory has been moved into HomePage
  // to access local state (subject, analysis)

  // --- UI Rendering ---

  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <Loader2 className="animate-spin h-12 w-12 text-cyan-400" />
      </div>
    );
  }

  const renderPage = () => {
    switch (page) {
      case 'home':
        return <HomePage
          deviceStatus={deviceStatus}
          liveSweepData={liveSweepData}
          uploadedSweepData={uploadedSweepData}
          setUploadedSweepData={setUploadedSweepData}
          isPapaParseLoaded={isPapaParseLoaded}
          sendDeviceCommand={sendDeviceCommand}
          isSendingCommand={isSendingCommand}
          db={db}
          userId={userId}
          appId={appId}
          calCoefficients={calCoefficients} // Pass down for saving
        />;
      case 'tomo': // --- NEW: Tomography Page ---
        return <TomographyPage
          tomoData={tomoData}
          setTomoData={setTomoData}
          isPapaParseLoaded={isPapaParseLoaded}
          db={db}
          userId={userId}
          appId={appId}
        />;
      case 'calibration':
        return <CalibrationPage
          calCoefficients={calCoefficients}
          sendDeviceCommand={sendDeviceCommand}
          isSendingCommand={isSendingCommand}
        />;
      case 'history':
        return <HistoryPage
          db={db}
          userId={userId}
          appId={appId}
        />;
      default:
        return <HomePage
          deviceStatus={deviceStatus}
          liveSweepData={liveSweepData}
          uploadedSweepData={uploadedSweepData}
          setUploadedSweepData={setUploadedSweepData}
          isPapaParseLoaded={isPapaParseLoaded}
          sendDeviceCommand={sendDeviceCommand}
          isSendingCommand={isSendingCommand}
          db={db}
          userId={userId}
          appId={appId}
          calCoefficients={calCoefficients} // Pass down for saving
        />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans">
      {/* --- Sidebar --- */}
      <nav className="w-64 bg-gray-950 p-5 flex flex-col justify-between shadow-lg">
        <div>
          <h1 className="text-2xl font-bold text-cyan-400 flex items-center mb-10">
            <Wifi className="mr-2" /> EIS Control
          </h1>
          <ul className="space-y-2">
            <li><NavButton text="Home" icon={<Home />} onClick={() => setPage('home')} active={page === 'home'} /></li>
            {/* --- NEW: Tomography Nav --- */}
            <li><NavButton text="Tomography" icon={<Map />} onClick={() => setPage('tomo')} active={page === 'tomo'} /></li>
            <li><NavButton text="Calibration" icon={<Beaker />} onClick={() => setPage('calibration')} active={page === 'calibration'} /></li>
            <li><NavButton text="History" icon={<History />} onClick={() => setPage('history')} active={page === 'history'} /></li>
          </ul>
        </div>
        <DeviceStatusIndicator status={deviceStatus} />
      </nav>

      {/* --- Main Content Area --- */}
      <main className="flex-1 p-8 overflow-y-auto w-full"> {/* ADDED w-full here */}
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin h-8 w-8 text-gray-400" />
            <span className="ml-3 text-lg text-gray-400">Loading Firebase Data...</span>
          </div>
        ) : (
          renderPage()
        )}
      </main>
    </div>
  );
}

/**
 * == Home Page Component ==
 * The main landing page with controls and live plots.
 */
function HomePage({
  deviceStatus,
  liveSweepData,
  uploadedSweepData,
  setUploadedSweepData,
  isPapaParseLoaded,
  sendDeviceCommand,
  isSendingCommand,
  db,
  userId,
  appId,
  calCoefficients
}) {
  const isDeviceOnline = (Date.now() / 1000 - (deviceStatus.heartbeat?.seconds || 0)) < 15; // 15 sec timeout (heartbeat is a Timestamp)
  const fileInputRef = useRef(null);

  // --- Lifted state for saving to history ---
  const [analysisHistory, setAnalysisHistory] = useState([]); // --- CHANGED: Was `analysis`
  const [subject, setSubject] = useState("");

  // --- Determine which data to display ---
  const dataToDisplay = uploadedSweepData.length > 0 ? uploadedSweepData : liveSweepData;

  /**
   * --- saveSweepToHistory ---
   * Saves the current data, analysis, and subject to history.
   */
  const saveSweepToHistory = async () => {
    const dataToSave = uploadedSweepData.length > 0 ? uploadedSweepData : liveSweepData;

    if (!db || !userId || dataToSave.length === 0) {
      alert("No data to save or user not authenticated.");
      return;
    }
    if (!subject) {
      alert("Please enter a 'Subject / Sample Name' before saving.");
      return;
    }
    
    try {
      const historyCollectionPath = `artifacts/${appId}/users/${userId}/${HISTORY_COLLECTION}`;
      await addDoc(collection(db, historyCollectionPath), {
        createdAt: serverTimestamp(),
        sweepData: dataToSave,
        calCoefficients: calCoefficients,
        subject: subject, // Save the subject
        analysisHistory: analysisHistory, // --- CHANGED: Save chat history
        type: 'sweep' // Mark as 1D sweep
      });
      alert(`Sweep for '${subject}' saved to History!`);
    } catch (e) {
      console.error("Error saving to history:", e);
      alert("Error saving data. See console for details.");
    }
  };


  // --- File Upload Handler ---
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file && window.Papa) {
      window.Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        complete: (results) => {
          try {
            const parsedData = results.data.map(row => {
              // Find keys case-insensitively
              const freqKey = Object.keys(row).find(k => k.toLowerCase() === 'frequency' || k.toLowerCase() === 'freq');
              const magKey = Object.keys(row).find(k => k.toLowerCase() === 'impedance' || k.toLowerCase() === 'mag' || k.toLowerCase() === 'magnitude');
              const phaseKey = Object.keys(row).find(k => k.toLowerCase() === 'phase');

              if (!freqKey || !magKey || !phaseKey) {
                // Check if it's a tomo file by mistake
                const xKey = Object.keys(row).find(k => k.toLowerCase() === 'x');
                if (xKey) {
                  throw new Error("This looks like a Tomography file. Please use the Tomography page.");
                }
                throw new Error("Missing required columns (frequency, impedance, phase)");
              }

              const freq = parseFloat(row[freqKey]);
              const mag = parseFloat(row[magKey]);
              const phase = parseFloat(row[phaseKey]);

              if (isNaN(freq) || isNaN(mag) || isNaN(phase)) {
                throw new Error("Invalid data types in CSV.");
              }

              const phaseRad = phase * (Math.PI / 180.0);
              return {
                freq,
                mag,
                phase,
                re: mag * Math.cos(phaseRad),
                im: mag * Math.sin(phaseRad)
              };
            });

            // Sort by frequency
            parsedData.sort((a, b) => a.freq - b.freq);
            setUploadedSweepData(parsedData);
            setAnalysisHistory([]); // Clear old analysis when new data is loaded
            setSubject(""); // Clear subject
          } catch (error) {
            alert(`Error parsing CSV: ${error.message}`);
          }
        },
        error: (error) => {
          alert(`Error reading file: ${error.message}`);
        }
      });
    }
    // Clear the file input so the same file can be re-uploaded
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClearUpload = () => {
    setUploadedSweepData([]);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-white">Home Control</h1>
        <div className={`flex items-center p-2 rounded-lg ${isDeviceOnline ? 'bg-green-800' : 'bg-red-800'}`}>
          {isDeviceOnline ? <CheckCircle className="text-green-300" /> : <AlertCircle className="text-red-300" />}
          <span className="ml-2 text-sm font-medium">{isDeviceOnline ? "Device Online" : "Device Offline"}</span>
        </div>
      </div>
      
      {/* --- Control Panel --- */}
      <div className="bg-gray-800 p-4 rounded-lg shadow-md">
        <h3 className="text-lg font-semibold mb-3">Device Control</h3>
        <div className="flex flex-wrap gap-4">
          <Button
            onClick={() => {
              sendDeviceCommand('RUN_SWEEP');
              setAnalysisHistory([]); // Clear analysis on new sweep
            }}
            text="Run Frequency Sweep"
            icon={<Play />}
            className="bg-green-600 hover:bg-green-700"
            disabled={!isDeviceOnline || isSendingCommand}
          />
          <Button
            onClick={() => {
              sendDeviceCommand('RUN_ANALYSIS');
              setAnalysisHistory([]); // Clear analysis on new sweep
            }}
            text="Run Soil Analysis (1D)"
            icon={<Play />}
            className="bg-blue-600 hover:bg-blue-700"
            disabled={!isDeviceOnline || isSendingCommand}
          />
          <Button
            onClick={saveSweepToHistory}
            text="Save Last Sweep"
            icon={<Save />}
            className="bg-purple-600 hover:bg-purple-700"
            disabled={dataToDisplay.length === 0 || !subject}
          />
        </div>
      </div>

      {/* --- Data Upload Panel (1D) --- */}
      <div className="bg-gray-800 p-4 rounded-lg shadow-md">
        <h3 className="text-lg font-semibold mb-3">Test with 1D Sweep Data</h3>
        <div className="flex flex-wrap gap-4">
          <input
            type="file"
            accept=".csv, text/csv"
            onChange={handleFileUpload}
            className="hidden" // Hide the default input
            ref={fileInputRef}
            id="csv-upload"
          />
          <Button
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            text="Upload 1D Data (CSV)"
            icon={<Upload />}
            className="bg-teal-600 hover:bg-teal-700"
            disabled={!isPapaParseLoaded}
          />
          {uploadedSweepData.length > 0 && (
            <Button
              onClick={handleClearUpload}
              text="Clear Uploaded Data"
              icon={<XCircle />}
              className="bg-red-600 hover:bg-red-700"
            />
          )}
        </div>
        {!isPapaParseLoaded && <p className="text-xs text-yellow-400 mt-2">Loading data parser...</p>}
        {uploadedSweepData.length > 0 && <p className="text-sm text-green-400 mt-2">Displaying data from uploaded file. Clear to see live data.</p>}
      </div>


      {/* --- Live Status Box --- */}
      <div className="bg-gray-800 p-4 rounded-lg shadow-md">
        <h3 className="text-lg font-semibold">Live Device Status</h3>
        <p className="text-cyan-300 font-mono mt-2">{deviceStatus.message || "Waiting for status..."}</p>
      </div>
      
      {/* --- UPGRADED: AI Analysis Box (1D) --- */}
      <GeminiAnalysis
        sweepData={dataToDisplay}
        tomoData={[]} // No 2D data here
        db={db}
        userId={userId}
        appId={appId}
        analysisHistory={analysisHistory}
        setAnalysisHistory={setAnalysisHistory}
        subject={subject}
        setSubject={setSubject}
      />

      {/* --- Live Plots (1D) --- */}
      <BodeNyquistPlots sweepData={dataToDisplay} title={uploadedSweepData.length > 0 ? "Uploaded Sweep Data" : "Live Sweep Data"} />
    </div>
  );
}


/**
 * == NEW: Tomography Page Component ==
 * Handles 2D data upload, plotting, and analysis.
 */
function TomographyPage({ tomoData, setTomoData, isPapaParseLoaded, db, userId, appId }) {
  const fileInputRef = useRef(null);
  const [analysisHistory, setAnalysisHistory] = useState([]); // --- CHANGED
  const [subject, setSubject] = useState("");
  const [plotMetric, setPlotMetric] = useState('mag'); // 'mag' or 'phase'
  const [plotFreq, setPlotFreq] = useState(100); // Default freq to plot
  const [availableFreqs, setAvailableFreqs] = useState([]);

  // --- File Upload Handler (2D) ---
  const handleTomoFileUpload = (event) => {
    const file = event.target.files[0];
    if (file && window.Papa) {
      window.Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        complete: (results) => {
          try {
            let freqs = new Set();
            const parsedData = results.data.map(row => {
              // Find keys case-insensitively
              const xKey = Object.keys(row).find(k => k.toLowerCase() === 'x');
              const yKey = Object.keys(row).find(k => k.toLowerCase() === 'y');
              const freqKey = Object.keys(row).find(k => k.toLowerCase() === 'frequency' || k.toLowerCase() === 'freq');
              const magKey = Object.keys(row).find(k => k.toLowerCase() === 'impedance' || k.toLowerCase() === 'mag' || k.toLowerCase() === 'magnitude');
              const phaseKey = Object.keys(row).find(k => k.toLowerCase() === 'phase');

              if (!xKey || !yKey || !freqKey || !magKey || !phaseKey) {
                throw new Error("Missing required columns (x, y, frequency, impedance, phase)");
              }

              const freq = parseFloat(row[freqKey]);
              freqs.add(freq); // Add to set of available freqs

              return {
                x: parseFloat(row[xKey]),
                y: parseFloat(row[yKey]),
                freq: freq,
                mag: parseFloat(row[magKey]),
                phase: parseFloat(row[phaseKey]),
              };
            });

            const sortedFreqs = Array.from(freqs).sort((a, b) => a - b);
            setAvailableFreqs(sortedFreqs);
            setPlotFreq(sortedFreqs[0] || 100); // Set to first available freq
            setTomoData(parsedData);
            setAnalysisHistory([]); // --- CHANGED
            setSubject("");
          } catch (error) {
            alert(`Error parsing 2D CSV: ${error.message}`);
          }
        },
        error: (error) => {
          alert(`Error reading file: ${error.message}`);
        }
      });
    }
    // Clear the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };
  
  const handleClearUpload = () => {
    setTomoData([]);
    setAvailableFreqs([]);
    setPlotFreq(100);
  };
  
  /**
   * --- saveTomoToHistory ---
   * Saves the current 2D data, analysis, and subject.
   */
  const saveTomoToHistory = async () => {
    if (!db || !userId || tomoData.length === 0) {
      alert("No data to save or user not authenticated.");
      return;
    }
    if (!subject) {
      alert("Please enter a 'Subject / Sample Name' before saving.");
      return;
    }
    
    try {
      const historyCollectionPath = `artifacts/${appId}/users/${userId}/${HISTORY_COLLECTION}`;
      await addDoc(collection(db, historyCollectionPath), {
        createdAt: serverTimestamp(),
        tomoData: tomoData, // Save 2D data
        subject: subject,
        analysisHistory: analysisHistory, // --- CHANGED
        type: 'tomo' // Mark as 2D scan
      });
      alert(`Tomography for '${subject}' saved to History!`);
    } catch (e) {
      console.error("Error saving to history:", e);
      alert("Error saving data. See console for details.");
    }
  };

  // Filter data for the 2D plot based on selected frequency
  const plotData = tomoData.filter(d => d.freq === plotFreq);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Tomography (2D Map)</h1>
      
      {/* --- Data Upload Panel (2D) --- */}
      <div className="bg-gray-800 p-4 rounded-lg shadow-md">
        <h3 className="text-lg font-semibold mb-3">Upload 2D Scan Data</h3>
        <p className="text-sm text-gray-400 mb-3">Upload a CSV file with columns: `x`, `y`, `frequency`, `impedance`, `phase`</p>
        <div className="flex flex-wrap gap-4">
          <input
            type="file"
            accept=".csv, text/csv"
            onChange={handleTomoFileUpload}
            className="hidden"
            ref={fileInputRef}
            id="csv-tomo-upload"
          />
          <Button
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            text="Upload 2D Data (CSV)"
            icon={<Upload />}
            className="bg-teal-600 hover:bg-teal-700"
            disabled={!isPapaParseLoaded}
          />
          {tomoData.length > 0 && (
            <Button
              onClick={handleClearUpload}
              text="Clear Uploaded Data"
              icon={<XCircle />}
              className="bg-red-600 hover:bg-red-700"
            />
          )}
          <Button
            onClick={saveTomoToHistory}
            text="Save Tomography"
            icon={<Save />}
            className="bg-purple-600 hover:bg-purple-700"
            disabled={tomoData.length === 0 || !subject}
          />
        </div>
        {!isPapaParseLoaded && <p className="text-xs text-yellow-400 mt-2">Loading data parser...</p>}
      </div>

      {/* --- 2D Plot Display --- */}
      {tomoData.length > 0 && (
        <div className="bg-gray-800 p-4 rounded-lg shadow-md">
          <h3 className="text-xl font-semibold text-white mb-4">Tomography Map</h3>
          {/* --- Plot Controls --- */}
          <div className="flex flex-wrap gap-4 items-center mb-4">
            <div>
              <label htmlFor="freq-select" className="block text-sm font-medium text-gray-300">Frequency</label>
              <select
                id="freq-select"
                value={plotFreq}
                onChange={(e) => setPlotFreq(Number(e.target.value))}
                className="bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                {availableFreqs.map(f => <option key={f} value={f}>{f} Hz</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="metric-select" className="block text-sm font-medium text-gray-300">Metric</label>
              <select
                id="metric-select"
                value={plotMetric}
                onChange={(e) => setPlotMetric(e.target.value)}
                className="bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                <option value="mag">Magnitude (Ω)</option>
                <option value="phase">Phase (°)</option>
              </select>
            </div>
          </div>
          {/* --- The Map --- */}
          <TomographyHeatmap data={plotData} metric={plotMetric} />
        </div>
      )}
      
      {/* --- AI Analysis (2D) --- */}
      <GeminiAnalysis
        sweepData={[]} // No 1D data here
        tomoData={tomoData} // Pass 2D data
        db={db}
        userId={userId}
        appId={appId}
        analysisHistory={analysisHistory} // --- CHANGED
        setAnalysisHistory={setAnalysisHistory} // --- CHANGED
        subject={subject}
        setSubject={setSubject}
      />
    </div>
  );
}


/**
 * == UPGRADED: Gemini Analysis Component ==
 * Now a full chat component.
 */
function GeminiAnalysis({
  sweepData,
  tomoData,
  db,
  userId,
  appId,
  analysisHistory,
  setAnalysisHistory,
  subject,
  setSubject
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [analysisType, setAnalysisType] = useState(tomoData.length > 0 ? 'soil' : 'general'); // Default to soil for tomo
  const [userFollowUp, setUserFollowUp] = useState(""); // --- NEW: For follow-up input
  const chatEndRef = useRef(null); // --- NEW: For auto-scrolling

  // --- Determine if we have data ---
  const hasSweepData = sweepData && sweepData.length > 0;
  const hasTomoData = tomoData && tomoData.length > 0;
  const hasData = hasSweepData || hasTomoData;

  // Update analysis type if data type changes
  useEffect(() => {
    setAnalysisType(hasTomoData ? 'soil' : 'general');
    setAnalysisHistory([]);
  }, [hasTomoData]);

  // --- NEW: Auto-scroll to bottom of chat ---
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [analysisHistory]);


  // --- Define AI Prompts and Schemas ---
  const analysisConfig = {
    general: { // 1D Sweep
      systemPrompt: `You are an expert in Electrochemical Impedance Spectroscopy (EIS).
A user has provided sweep data. Provide a brief, one-paragraph summary of what the data represents (e.g., capacitive, resistive, diffusion).
Then, list 2-3 key metrics or observations.
All data is under 5kHz.
`,
      schema: {
        type: "OBJECT",
        properties: {
          report_title: { type: "STRING", description: "e.g., 'General EIS Analysis'" },
          summary: { type: "STRING", description: "A one-paragraph summary." },
          metrics: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING", description: "Name of the metric (e.g., 'Low-Freq Behavior')" },
                value: { type: "STRING", description: "Value (e.g., 'Capacitive')" },
                insight: { type: "STRING", description: "Brief insight" }
              }
            }
          }
        }
      }
    },
    soil: { // 1D Sweep or 2D Tomo
      systemPrompt: `You are an agricultural EIS expert. The data is from a soil sample (sub-5kHz).
Analyze the data to estimate moisture and salinity.
- Moisture: Correlates with the phase angle at low frequencies (e.g., 100Hz). A more negative phase suggests higher moisture.
- Salinity: Correlates with the overall impedance magnitude at high frequencies (e.g., 5kHz). Lower impedance suggests higher salinity.
${hasTomoData ? "The user provided a 2D tomography map. Your analysis MUST focus on SPATIAL VARIATION. Identify areas (e.g., 'Top-Left', 'Center') of high/low moisture or salinity." : "Provide a summary and specific metrics for moisture and salinity."}
`,
      schema: {
        type: "OBJECT",
        properties: {
          report_title: { type: "STRING", description: `e.g., '${hasTomoData ? "2D Soil Map Analysis" : "Soil Analysis Report"}'` },
          summary: { type: "STRING", description: `A one-paragraph summary of soil health. ${hasTomoData ? "Focus on spatial variations." : ""}` },
          metrics: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING", description: "e.g., 'Moisture Index' or 'Salinity (Spatial)'" },
                value: { type: "STRING", description: "e.g., 'High' or 'High in center, low at edges'" },
                insight: { type: "STRING", description: "e.g., 'Based on low-freq phase' or 'Based on high-freq magnitude map'" }
              }
            }
          }
        }
      }
    },
    plant: { // 1D Sweep
      systemPrompt: `You are a plant pathologist using EIS. The data is from a plant stem or leaf (sub-5kHz).
Analyze the data for signs of early stress or disease.
- Stress (e.g., dehydration, nutrient loss): Often increases overall impedance.
- Disease (e.g., cell wall breakdown): Often decreases impedance, especially at low frequencies, and changes the phase.
Provide a summary and metrics for plant health.
`,
      schema: {
        type: "OBJECT",
        properties: {
          report_title: { type: "STRING", description: "e.g., 'Plant Health Analysis'" },
          summary: { type: "STRING", description: "A one-paragraph summary of plant health." },
          metrics: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING", description: "e.g., 'Stress Level' or 'Disease Indicator'" },
                value: { type: "STRING", description: "e.g., 'High' or 'Potential cell degradation'" },
                insight: { type: "STRING", description: "e.g., 'Based on high impedance' or 'Based on low-freq phase shift'" }
              }
            }
          }
        }
      }
    }
  };

  /**
   * --- Fetches historical context ---
   */
  const getHistoricalContext = async () => {
    if (!subject || !db || !userId) {
      return ""; // No subject, no context
    }

    try {
      const historyCollectionPath = `artifacts/${appId}/users/${userId}/${HISTORY_COLLECTION}`;
      const q = query(
        collection(db, historyCollectionPath),
        where("subject", "==", subject),
        orderBy("createdAt", "desc"),
        limit(5) // Fetch 5
      );

      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        return ""; // No history for this subject
      }

      let context = "--- Historical Context for Subject --- \n";
      querySnapshot.docs.reverse().forEach(doc => { // Oldest first
        const data = doc.data();
        const date = data.createdAt ? new Date(data.createdAt.toDate()).toLocaleString() : "Previous";
        context += `\n[${date}]\n`;
        // --- UPDATED: Look for analysisHistory ---
        if (data.analysisHistory && data.analysisHistory.length > 0) {
          // Get the last model response from that history
          const lastModelResponse = data.analysisHistory.filter(m => m.role === 'model').pop();
          if (lastModelResponse && lastModelResponse.content.summary) {
            context += `Summary: ${lastModelResponse.content.summary}\n`;
          }
        } else if (data.sweepData) {
          // Add a summary of 1D data
          const first = data.sweepData[0];
          const last = data.sweepData[data.sweepData.length - 1];
          context += `Data (1D): ${data.sweepData.length} points. LF: ${first.mag.toFixed(0)}Ω, HF: ${last.mag.toFixed(0)}Ω\n`;
        } else if (data.tomoData) {
          context += `Data (2D): ${data.tomoData.length} data points.\n`;
        }
      });
      context += "--- End of Historical Context ---\n\n";
      return context;

    } catch (e) {
      console.error("Error fetching history:", e);
      return ""; // Fail silently, just don't provide context
    }
  };

  /**
   * --- NEW: handleApiCall ---
   * Reusable function to call Gemini API with chat history.
   */
  const handleApiCall = async (currentChatHistory, systemPrompt, schema) => {
    // --- NEW: Check for API Key ---
    if (!GEMINI_API_KEY) {
      // Don't even try to call the API.
      // In a real app, the key would be provided by the environment, but here it's empty.
      // We'll return a helpful mock error instead of a 403.
      console.error("Gemini API Key is empty. Returning mock response.");
      setError("AI Analysis is not configured (API Key is missing).");
      return null;
    }
    
    setIsAnalyzing(true);
    setError("");

    // --- Convert our chat history to Gemini's format ---
    const geminiContents = currentChatHistory.map(msg => {
      if (msg.role === 'user') {
        return { role: 'user', parts: [{ text: msg.content }] };
      } else {
        // Model content can be an object (structured) or string (follow-up)
        const content = (typeof msg.content === 'object') ? JSON.stringify(msg.content) : msg.content;
        return { role: 'model', parts: [{ text: content }] };
      }
    });

    const payload = {
      contents: geminiContents,
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    };
    
    // --- For follow-up, response schema might be simpler text ---
    if (currentChatHistory.length > 2) { // i.e., this is a follow-up
      payload.generationConfig.responseMimeType = "text/plain";
      delete payload.generationConfig.responseSchema;
    }

    // --- Exponential Backoff Retry ---
    let response;
    let delay = 1000;
    for (let i = 0; i < 3; i++) { // Max 3 retries
      try {
        response = await fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) break; // Success
        if (!response.ok && response.status < 500) { 
           throw new Error(`API request failed with status: ${response.status}`);
        }
        await new Promise(res => setTimeout(res, delay));
        delay *= 2; 

      } catch (e) {
        if (i === 2) { 
           setError("Network error. Could not connect to the analysis service.");
           setIsAnalyzing(false);
           return null;
        }
        await new Promise(res => setTimeout(res, delay));
        delay *= 2;
      }
    }

    if (!response || !response.ok) {
      setError("Failed to get analysis after retries.");
      setIsAnalyzing(false);
      return null;
    }

    try {
      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        setError("Could not parse the analysis from the response.");
        return null;
      }
      
      // If we requested JSON, parse it. Otherwise, return text.
      if (payload.generationConfig.responseMimeType === "application/json") {
        return JSON.parse(text);
      }
      return text; // This is a plain text follow-up

    } catch (e) {
      setError("Error processing the analysis response: " + e.message);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  };


  /**
   * --- handleAnalyze (NEW CHAT) ---
   */
  const handleAnalyze = async () => {
    if (!hasData) {
      setError("No data available to analyze.");
      return;
    }
    
    setAnalysisHistory([]); // Start a new chat
    
    const config = analysisConfig[analysisType];
    const historyContext = await getHistoricalContext();
    
    let dataString;
    if (hasTomoData) {
      dataString = "Type: 2D Tomography Map\n";
      // --- FIX: Stray dot removed ---
      const freqs = [...new Set(tomoData.map(d => d.freq))];
      dataString += `Frequencies: ${freqs.join(', ')} Hz\n`;
      dataString += `Spatial Points: ${tomoData.length / freqs.length}\n`;
      dataString += `Data summary (first 5 points):\n`
      dataString += tomoData.slice(0, 5).map(d => `(x:${d.x}, y:${d.y}) @ ${d.freq}Hz: ${d.mag.toFixed(0)}Ω, ${d.phase.toFixed(1)}°`).join('\n');
    } else {
      dataString = "Type: 1D Frequency Sweep\n";
      dataString += sweepData.map(d => `Freq: ${d.freq.toFixed(0)} Hz, Mag: ${d.mag.toFixed(2)} Ω, Phase: ${d.phase.toFixed(2)}°`).join('\n');
    }

    const systemPrompt = `${config.systemPrompt}
${historyContext ? `--- TASK: TREND ANALYSIS ---
The user has provided historical context for this *same subject*.
Your primary task is to compare the NEW data to this context.
Specifically look for:
1.  **Magnitude Trend:** Is the overall impedance at key frequencies (e.g., 100Hz, 5kHz) increasing or decreasing over time?
2.  **Phase Trend:** Is the phase at low frequencies (e.g., 100Hz) becoming more or less negative?
3.  **Anomaly Detection:** Is this new reading a significant deviation from the historical average, or part of a stable trend?
Your summary *must* include this trend analysis.
` : ""}
Provide your final answer as a single, valid JSON object matching the requested schema.`;

    const userQuery = `${historyContext}
Here is the NEW sweep data to analyze:
${dataString}
Please provide the analysis for the NEW data, comparing it to the historical context if provided.`;

    const firstUserMessage = { role: 'user', content: userQuery };
    const newChatHistory = [firstUserMessage];
    
    const modelResponse = await handleApiCall(newChatHistory, systemPrompt, config.schema);
    
    if (modelResponse) {
      const firstModelMessage = { role: 'model', content: modelResponse };
      setAnalysisHistory([firstUserMessage, firstModelMessage]);
    } else {
      setAnalysisHistory([]); // Clear on error
    }
  };

  /**
   * --- handleFollowUp (CONTINUE CHAT) ---
   */
  const handleFollowUp = async (e) => {
    e.preventDefault();
    if (!userFollowUp.trim()) return;

    const newUserMessage = { role: 'user', content: userFollowUp };
    const currentChatHistory = [...analysisHistory, newUserMessage];
    
    setAnalysisHistory(currentChatHistory); // Show user message immediately
    setUserFollowUp(""); // Clear input

    // For follow-ups, the system prompt is simpler
    const followUpSystemPrompt = `You are an expert EIS assistant.
The user has provided data and a subject context, and you have provided an initial analysis.
Now, answer the user's follow-up question based on the *entire* chat history.
Be helpful and concise. If the user asks for new metrics, provide them.
`;
    
    const modelResponse = await handleApiCall(currentChatHistory, followUpSystemPrompt);
    
    if (modelResponse) {
      const newModelMessage = { role: 'model', content: modelResponse };
      setAnalysisHistory([...currentChatHistory, newModelMessage]);
    }
    // Don't clear on error, just let the error message show
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-md">
      <h3 className="text-lg font-semibold mb-3">AI Analysis</h3>
      
      {/* --- Subject Input --- */}
      <div className="mb-4">
        <label htmlFor="subject" className="block text-sm font-medium text-gray-300 mb-1">
          Subject / Sample Name (for history)
        </label>
        <div className="relative">
          <Edit3 className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
          <input
            type="text"
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g., 'West Plot 3' or 'Ficus Plant'"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
          />
        </div>
      </div>
      
      {/* --- Analysis Type Buttons --- */}
      {/* --- FIX: Fixed className typo --- */}
      <div className="flex flex-wrap gap-2 mb-4">
        <AnalysisTypeButton
          text="General"
          icon={<FlaskConical />}
          active={analysisType === 'general'}
          onClick={() => setAnalysisType('general')}
          disabled={hasTomoData} // Disable if 2D
        />
        <AnalysisTypeButton
          text="Soil (Moisture/Salinity)"
          icon={<Droplets />}
          active={analysisType === 'soil'}
          onClick={() => setAnalysisType('soil')}
        />
        <AnalysisTypeButton
          text="Plant (Stress/Disease)"
          icon={<Leaf />}
          active={analysisType === 'plant'}
          onClick={() => setAnalysisType('plant')}
          disabled={hasTomoData} // Disable if 2D
        />
      </div>
      
      <Button
        onClick={handleAnalyze}
        text="Start New Analysis"
        icon={<Sparkles />}
        className="bg-indigo-600 hover:bg-indigo-700"
        disabled={isAnalyzing || !hasData}
      />
      
      {/* --- NEW: Chat History Display --- */}
      <div className="mt-4 border-t border-gray-700 pt-4 space-y-4 max-h-[50vh] overflow-y-auto">
        {analysisHistory.map((msg, index) => (
          <ChatBubble key={index} role={msg.role} content={msg.content} />
        ))}
        {isAnalyzing && (
          <div className="flex items-center">
            <Loader2 className="animate-spin h-5 w-5 text-gray-400" />
            <p className="ml-2 text-gray-400">AI is thinking...</p>
          </div>
        )}
        <div ref={chatEndRef} /> {/* For auto-scrolling */}
      </div>
      
      {error && <p className="mt-4 text-red-400">{error}</p>}
      
      {/* --- NEW: Follow-up Input --- */}
      {analysisHistory.length > 0 && (
        <form onSubmit={handleFollowUp} className="mt-4 flex gap-2">
          <input
            type="text"
            value={userFollowUp}
            onChange={(e) => setUserFollowUp(e.target.value)}
            placeholder="Send a follow-up message..."
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
            disabled={isAnalyzing}
          />
          <Button
            text="Send"
            icon={<Send />}
            type="submit"
            className="bg-cyan-600 hover:bg-cyan-700"
            disabled={isAnalyzing || !userFollowUp.trim()}
          />
        </form>
      )}
    </div>
  );
}


/**
 * == Calibration Page Component ==
 * Shows formulas and handles calibration.
 */
function CalibrationPage({ calCoefficients, sendDeviceCommand, isSendingCommand }) {
  const [flashKey, setFlashKey] = useState(0);

  // This effect creates the "flash" animation
  useEffect(() => {
    if (Object.keys(calCoefficients).length > 0) {
      setFlashKey(k => k + 1); // Increment key to re-trigger animation
    }
  }, [calCoefficients]);

  // Helper to format the coefficients
  const f = (val, precision = 6) => val ? val.toFixed(precision) : '?.??';

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Calibration</h1>
      
      {/* --- Control Panel --- */}
      <div className="bg-gray-800 p-4 rounded-lg shadow-md">
        <h3 className="text-lg font-semibold mb-3">Run Calibration</h3>
        <div className="flex space-x-4">
          <Button
            onClick={() => {
              const r = prompt("Enter KNOWN resistor value (Ω) for Mag Cal:", "10000");
              if (r) sendDeviceCommand('RUN_MAG_CAL', { knownResistor: parseFloat(r) });
            }}
            text="Start Magnitude Cal"
            icon={<Beaker />}
            className="bg-yellow-600 hover:bg-yellow-700"
            disabled={isSendingCommand}
          />
          <Button
            onClick={() => sendDeviceCommand('RUN_PHASE_CAL')}
            text="Start Phase Cal"
            icon={<Beaker />}
            className="bg-yellow-600 hover:bg-yellow-700"
            disabled={isSendingCommand}
          />
        </div>
      </div>

      {/* --- "Single Line" Formulas --- */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-md font-mono text-lg" key={flashKey}>
        <h3 className="text-xl font-semibold text-cyan-400 mb-6">Current Calibration Coefficients</h3>
        
        <div className="space-y-8"> {/* Stacks the sections vertically */}
          
          {/* Magnitude (Low-F) Section */}
          <div>
            <h4 className="text-base font-semibold text-gray-300 mb-2">Magnitude (Low-F)</h4>
            <p className="text-white text-md">
              <span className="text-blue-400">Z</span> *= <ValueAnimator value={f(calCoefficients.MAG1_A)} /> + <ValueAnimator value={f(calCoefficients.MAG1_B, 7)} /> * <span className="text-yellow-400">ln(f)</span>
            </p>
            <div className="text-xs text-gray-500 mt-2">
              <span className="font-semibold text-blue-300">A</span>: <ValueAnimator value={f(calCoefficients.MAG1_A)} brief />
              <span className="ml-4 font-semibold text-green-300">B</span>: <ValueAnimator value={f(calCoefficients.MAG1_B, 7)} brief />
            </div>
          </div>

          {/* Magnitude (High-F) Section */}
          <div>
            <h4 className="text-base font-semibold text-gray-300 mb-2">Magnitude (High-F)</h4>
            <p className="text-white text-md">
              <span className="text-blue-400">Z</span> *= <ValueAnimator value={f(calCoefficients.MAG2_A)} /> + <ValueAnimator value={f(calCoefficients.MAG2_B, 7)} /> * <span className="text-yellow-400">ln(f)</span>
            </p>
            <div className="text-xs text-gray-500 mt-2">
              <span className="font-semibold text-blue-300">A</span>: <ValueAnimator value={f(calCoefficients.MAG2_A)} brief />
              <span className="ml-4 font-semibold text-green-300">B</span>: <ValueAnimator value={f(calCoefficients.MAG2_B, 7)} brief />
            </div>
          </div>
          
          {/* Phase Section */}
          <div>
            <h4 className="text-base font-semibold text-gray-300 mb-2">Phase</h4>
            <p className="text-white text-md flex flex-wrap items-center">
              <span className="text-red-400 mr-2">φ</span> += <ValueAnimator value={f(calCoefficients.PHASE_A, 3)} /> 
              <span className="ml-2">+ (<ValueAnimator value={f(calCoefficients.PHASE_B)} /> * <span className="text-orange-400">f</span>)</span>
              <span className="ml-2">+ (<ValueAnimator value={f(calCoefficients.PHASE_C)} /> * <span className="text-yellow-400">ln(f)</span>)</span>
              <span className="ml-2">+ (<ValueAnimator value={f(calCoefficients.PHASE_D)} /> / <span className="text-green-400">f</span>)</span>
            </p>
            <div className="text-xs text-gray-500 mt-2 flex flex-wrap gap-x-4">
              <span className="font-semibold text-blue-300">A</span>: <ValueAnimator value={f(calCoefficients.PHASE_A, 3)} brief />
              <span className="font-semibold text-green-300">B</span>: <ValueAnimator value={f(calCoefficients.PHASE_B)} brief />
              <span className="font-semibold text-orange-300">C</span>: <ValueAnimator value={f(calCoefficients.PHASE_C)} brief />
              <span className="font-semibold text-red-300">D</span>: <ValueAnimator value={f(calCoefficients.PHASE_D)} brief />
            </div>
          </div>

        </div>
      </div>
      <style>{`
        @keyframes bounceIn {
          0% { transform: scale(0.9); opacity: 0; }
          60% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); }
        }
        .animate-bounceIn {
          animation: bounceIn 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}


/**
 * == History Page Component ==
 * Shows a list of saved sweeps and their plots.
 */
function HistoryPage({ db, userId, appId }) {
  const [history, setHistory] =useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSweep, setSelectedSweep] = useState(null);
  const chatEndRef = useRef(null); // For scrolling in history chat

  useEffect(() => {
    if (!db || !userId) return;

    const historyCollectionPath = `artifacts/${appId}/users/${userId}/${HISTORY_COLLECTION}`;
    const q = query(collection(db, historyCollectionPath), orderBy("createdAt", "desc"));
    
    setLoading(true);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const historyData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      setHistory(historyData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching history:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [db, userId, appId]);
  
  // Scroll to bottom of chat when sweep changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView();
  }, [selectedSweep]);


  if (loading) {
    return <div className="flex justify-center mt-10"><Loader2 className="animate-spin h-8 w-8 text-gray-400" /></div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Sweep History</h1>
      {history.length === 0 ? (
        <p className="text-gray-400">No saved sweeps. Run a sweep and click "Save Last Sweep".</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* --- History List --- */}
          <div className="bg-gray-800 p-4 rounded-lg shadow-md max-h-[70vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-3">Saved Runs</h3>
            <ul className="space-y-2">
              {history.map(item => (
                <li key={item.id}>
                  <button
                    onClick={() => setSelectedSweep(item)}
                    className={`w-full text-left p-3 rounded-lg ${selectedSweep?.id === item.id ? 'bg-cyan-800' : 'bg-gray-700 hover:bg-gray-600'}`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-semibold">{item.subject || "Unnamed Subject"}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${item.type === 'tomo' ? 'bg-blue-600' : 'bg-green-600'}`}>
                        {item.type === 'tomo' ? '2D Tomo' : '1D Sweep'}
                      </span>
                    </div>
                    <span className="text-sm text-gray-400">
                      {item.createdAt ? new Date(item.createdAt.toDate()).toLocaleString() : "Sweep"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          
          {/* --- Plot Display --- */}
          <div className="bg-gray-800 p-4 rounded-lg shadow-md max-h-[70vh] overflow-y-auto">
            {selectedSweep ? (
              <div className="space-y-6">
                {selectedSweep.type === 'tomo' ? (
                  // --- Display 2D Tomo Data ---
                  <div className="space-y-4">
                    <h3 className="text-xl font-semibold text-white">
                      Tomography: {selectedSweep.subject}
                    </h3>
                    {/* --- FIX: Fixed typo </to> to </p> --- */}
                    <p className="text-sm text-gray-400">
                      Note: This is a simplified static view. Controls for frequency and metric are on the Tomography page.
                    </p>
                    <TomographyHeatmap
                      data={selectedSweep.tomoData.filter(d => d.freq === selectedSweep.tomoData[0].freq)} // Show first freq
                      metric="mag"
                    />
                    <TomographyHeatmap
                      data={selectedSweep.tomoData.filter(d => d.freq === selectedSweep.tomoData[0].freq)} // Show first freq
                      metric="phase"
                    />
                  </div>
                ) : (
                  // --- Display 1D Sweep Data ---
                  <BodeNyquistPlots
                    sweepData={selectedSweep.sweepData}
                    // --- FIX: Defensive check for createdAt ---
                    title={`Sweep: ${selectedSweep.subject}${selectedSweep.createdAt?.toDate ? ` (${new Date(selectedSweep.createdAt.toDate()).toLocaleTimeString()})` : ""}`}
                  />
                )}
                
                {/* --- Show saved analysis --- */}
                <div className="border-t border-gray-700 pt-4">
                  <h3 className="text-lg font-semibold text-white mb-3">Saved Analysis Chat</h3>
                  {selectedSweep.analysisHistory && selectedSweep.analysisHistory.length > 0 ? (
                    <div className="space-y-4">
                      {selectedSweep.analysisHistory.map((msg, index) => (
                        <ChatBubble key={index} role={msg.role} content={msg.content} />
                      ))}
                      <div ref={chatEndRef} />
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center">No AI Analysis was saved for this sweep.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-400">Select a sweep from the list to view its plots.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}