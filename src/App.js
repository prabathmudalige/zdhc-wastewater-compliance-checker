import React, { useState, useEffect, useRef } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';

// Firebase Imports
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, query, getDocs, deleteDoc } from 'firebase/firestore';

// Define compliance limits based on ZDHC Wastewater Guidelines V2.2
// Note: This is an expanded subset for demonstration.
// Values are in ug/L for MRSL, mg/L for Heavy Metals and Conventional unless specified.
// 'T' for Textile, 'L' for Leather. 'F' for Foundational, 'P' for Progressive, 'A' for Aspirational.
const complianceLimits = {
    // ZDHC MRSL Parameters (Reporting Limits for Untreated Wastewater)
    mrsl: {
        np: { F: 5 }, npeo: { F: 5 }, op: { F: 5 }, opeo: { F: 5 },
        triclosan: { F: 100 }, permethrin: { F: 500 },
        sccps: { F: 25 }, mccps: { F: 500 }, pcp: { F: 0.5 },
        benzene: { F: 1 }, toluene: { F: 1 }, xylene: { F: 1 },
        dehp: { F: 10 }, pfos: { F: 0.01 }, pfoa: { F: 1 },
        benzidine: { F: 0.1 }, o_toluidine: { F: 0.1 }
    },
    // Heavy Metals (Discharged Wastewater)
    heavyMetals: {
        arsenic: { T: { F: 0.05, P: 0.01, A: 0.005 }, L: { F: 0.05, P: 0.01, A: 0.005 } },
        cadmium: { T: { F: 0.01, P: 0.005, A: 0.001 }, L: { F: 0.01, P: 0.005, A: 0.001 } },
        chromiumVI: { T: { F: 0.05, P: 0.01, A: 0.005 }, L: { F: 0.15, P: 0.05, A: 0.01 } },
        totalChromium: { T: { F: 0.2, P: 0.1, A: 0.05 }, L: { F: 0.5, P: 0.2, A: 0.1 } },
        copper: { T: { F: 0.1, P: 0.05, A: 0.02 }, L: { F: 0.1, P: 0.05, A: 0.02 } },
        lead: { T: { F: 0.05, P: 0.01, A: 0.005 }, L: { F: 0.05, P: 0.01, A: 0.005 } },
        mercury: { T: { F: 0.01, P: 0.005, A: 0.001 }, L: { F: 0.01, P: 0.005, A: 0.001 } },
        nickel: { T: { F: 0.2, P: 0.1, A: 0.05 }, L: { F: 0.2, P: 0.1, A: 0.05 } },
        zinc: { T: { F: 0.5, P: 0.2, A: 0.1 }, L: { F: 0.5, P: 0.2, A: 0.1 } }
    },
    // Conventional Parameters (Discharged Wastewater)
    conventional: {
        ph: { T: { F: { min: 6, max: 9 }, P: { min: 6, max: 9 }, A: { min: 6, max: 9 } }, L: { F: { min: 6, max: 9 }, P: { min: 6, max: 9 }, A: { min: 6, max: 9 } } },
        temp_diff: { T: { F: 15, P: 10, A: 5 }, L: { F: 15, P: 10, A: 5 } },
        e_coli: { T: { F: 126, P: 100, A: 50 }, L: { F: 126, P: 100, A: 50 } },
        bod5: { T: { F: 30, P: 20, A: 10 }, L: { F: 50, P: 30, A: 15 } },
        cod: { T: { F: 150, P: 80, A: 40 }, L: { F: 250, P: 150, A: 75 } },
        tss: { T: { F: 50, P: 30, A: 15 }, L: { F: 70, P: 40, A: 20 } },
        aox: { T: { F: 3, P: 1, A: 0.5 }, L: { F: 3, P: 1, A: 0.5 } },
        oil_grease: { T: { F: 10, P: 5, A: 2 }, L: { F: 20, P: 10, A: 5 } },
        total_phenols: { T: { F: 0.5, P: 0.1, A: 0.05 }, L: { F: 0.5, P: 0.1, A: 0.05 } },
        total_nitrogen: { T: { F: 20, P: 10, A: 5 }, L: { F: 35, P: 20, A: 10 } },
        total_phosphorus: { T: { F: 3, P: 1, A: 0.5 }, L: { F: 3, P: 1, A: 0.5 } },
        sulphide: { T: { F: 0.5, P: 0.1, A: 0.05 }, L: { F: 1, P: 0.2, A: 0.1 } }
    },
    // Simplified Sludge Parameters (Foundational Limits) - Values in mg/kg unless specified
    // Note: Full sludge compliance is complex and depends on disposal pathway and leachate testing.
    // This is a highly simplified representation for demonstration.
    sludge: {
        np: { F: 0.4 }, // Alkylphenol (AP) and Alkylphenol Ethoxylates (APEOs)
        pcp: { F: 0.2 }, // Pentachlorophenol
        arsenic_sludge: { F: 5 }, // Arsenic total in sludge (Textile)
        chromiumVI_sludge: { F: 0.5 }, // Chromium VI total in sludge
        mercury_sludge: { F: 0.1 }, // Mercury total in sludge
        ph_sludge: { F: { min: 5, max: 11 } }, // pH range for sludge
        faecal_coliform: { F: 1000 } // Faecal Coliform (MPN/g)
    }
};

const App = () => {
    // Firebase states
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState('Loading...');
    const [isAuthReady, setIsAuthReady] = useState(false);

    // Form states
    const [params, setParams] = useState({
        // MRSL
        np: '', npeo: '', op: '', opeo: '', triclosan: '', permethrin: '',
        sccps: '', mccps: '', pcp: '', benzene: '', toluene: '', xylene: '',
        dehp: '', pfos: '', pfoa: '', benzidine: '', o_toluidine: '',
        // Heavy Metals
        arsenic: '', cadmium: '', chromiumVI: '', totalChromium: '',
        copper: '', lead: '', mercury: '', nickel: '', zinc: '',
        // Conventional
        ph: '', temp_diff: '', e_coli: '', bod5: '', cod: '', tss: '',
        aox: '', oil_grease: '', total_phenols: '', total_nitrogen: '',
        total_phosphorus: '', sulphide: '',
        // Sludge (simplified)
        np_sludge: '', pcp_sludge: '', arsenic_sludge: '', chromiumVI_sludge: '',
        mercury_sludge: '', ph_sludge: '', faecal_coliform: ''
    });

    // Selection states
    const [industryType, setIndustryType] = useState('T'); // 'T' for Textile, 'L' for Leather
    const [complianceLevel, setComplianceLevel] = useState('F'); // 'F', 'P', 'A'
    const [dischargeType, setDischargeType] = useState('Direct'); // 'Direct', 'Indirect', 'ZLD'

    // UI states
    const [results, setResults] = useState([]);
    const [showResults, setShowResults] = useState(false);
    const [chartData, setChartData] = useState([]);
    const [overallCompliant, setOverallCompliant] = useState(true);
    const [message, setMessage] = useState(''); // For user feedback (save/load messages)

    // Collapsible sections state
    const [isMrslOpen, setIsMrslOpen] = useState(true);
    const [isHeavyMetalsOpen, setIsHeavyMetalsOpen] = useState(true);
    const [isConventionalOpen, setIsConventionalOpen] = useState(true);
    const [isSludgeOpen, setIsSludgeOpen] = useState(true);

    // Firebase Initialization
    useEffect(() => {
        try {
            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
            const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');

            if (Object.keys(firebaseConfig).length === 0) {
                console.error("Firebase config is empty. Cannot initialize Firebase.");
                setMessage("Error: Firebase not configured. Cannot save/load data.");
                return;
            }

            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const authInstance = getAuth(app);

            setDb(firestore);
            setAuth(authInstance);

            onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    try {
                        // Sign in anonymously if no user is authenticated
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await signInWithCustomToken(authInstance, __initial_auth_token);
                            setUserId(authInstance.currentUser.uid);
                        } else {
                            await signInAnonymously(authInstance);
                            setUserId(authInstance.currentUser.uid);
                        }
                    } catch (error) {
                        console.error("Firebase Auth Error:", error);
                        setMessage(`Auth Error: ${error.message}`);
                        setUserId('Auth Failed');
                    }
                }
                setIsAuthReady(true);
            });
        } catch (error) {
            console.error("Failed to initialize Firebase:", error);
            setMessage(`Firebase Init Error: ${error.message}`);
        }
    }, []);

    // Function to handle input changes
    const handleChange = (e) => {
        const { id, value } = e.target;
        setParams(prevParams => ({
            ...prevParams,
            [id]: value
        }));
    };

    // Helper function to get input value and check if it's a valid number
    const getInputValue = (id) => {
        const value = parseFloat(params[id]);
        return isNaN(value) ? null : value;
    };

    // Function to get the correct limit based on industry and compliance level
    const getLimit = (paramLimits) => {
        if (!paramLimits) return null;

        let levelLimits;
        if (typeof paramLimits[industryType] !== 'undefined') {
            // Parameter has industry-specific limits
            levelLimits = paramLimits[industryType];
        } else {
            // Parameter has universal limits (e.g., MRSL or Sludge)
            levelLimits = paramLimits;
        }

        // Try to get the specific compliance level limit (P, A, F)
        let limit = levelLimits[complianceLevel];

        // If the specific level is not defined, fall back to Foundational if available
        if (typeof limit === 'undefined' && typeof levelLimits['F'] !== 'undefined') {
            limit = levelLimits['F'];
        }

        return limit !== undefined ? limit : null; // Ensure it's never undefined, return null instead
    };

    // Define parameter arrays outside checkCompliance for JSX access
    const mrslParams = [
        { id: 'np', name: 'Nonylphenol (NP)', limits: complianceLimits.mrsl.np, unit: 'µg/L' },
        { id: 'npeo', name: 'Nonylphenol Ethoxylates (NPEO)', limits: complianceLimits.mrsl.npeo, unit: 'µg/L' },
        { id: 'op', name: 'Octylphenol (OP)', limits: complianceLimits.mrsl.op, unit: 'µg/L' },
        { id: 'opeo', name: 'Octylphenol Ethoxylates (OPEO)', limits: complianceLimits.mrsl.opeo, unit: 'µg/L' },
        { id: 'triclosan', name: 'Triclosan', limits: complianceLimits.mrsl.triclosan, unit: 'µg/L' },
        { id: 'permethrin', name: 'Permethrin', limits: complianceLimits.mrsl.permethrin, unit: 'µg/L' },
        { id: 'sccps', name: 'SCCPs', limits: complianceLimits.mrsl.sccps, unit: 'µg/L' },
        { id: 'mccps', name: 'MCCPs', limits: complianceLimits.mrsl.mccps, unit: 'µg/L' },
        { id: 'pcp', name: 'Pentachlorophenol (PCP)', limits: complianceLimits.mrsl.pcp, unit: 'µg/L' },
        { id: 'benzene', name: 'Benzene', limits: complianceLimits.mrsl.benzene, unit: 'µg/L' },
        { id: 'toluene', name: 'Toluene', limits: complianceLimits.mrsl.toluene, unit: 'µg/L' },
        { id: 'xylene', name: 'Xylene', limits: complianceLimits.mrsl.xylene, unit: 'µg/L' },
        { id: 'dehp', name: 'DEHP (Phthalate)', limits: complianceLimits.mrsl.dehp, unit: 'µg/L' },
        { id: 'pfos', name: 'PFOS', limits: complianceLimits.mrsl.pfos, unit: 'µg/L' },
        { id: 'pfoa', name: 'PFOA', limits: complianceLimits.mrsl.pfoa, unit: 'µg/L' },
        { id: 'benzidine', name: 'Benzidine', limits: complianceLimits.mrsl.benzidine, unit: 'µg/L' },
        { id: 'o_toluidine', name: 'o-Toluidine', limits: complianceLimits.mrsl.o_toluidine, unit: 'µg/L' },
    ];

    const heavyMetalParams = [
        { id: 'arsenic', name: 'Arsenic', limits: complianceLimits.heavyMetals.arsenic, unit: 'mg/L' },
        { id: 'cadmium', name: 'Cadmium', limits: complianceLimits.heavyMetals.cadmium, unit: 'mg/L' },
        { id: 'chromiumVI', name: 'Chromium (VI)', limits: complianceLimits.heavyMetals.chromiumVI, unit: 'mg/L' },
        { id: 'totalChromium', name: 'Chromium, total', limits: complianceLimits.heavyMetals.totalChromium, unit: 'mg/L' },
        { id: 'copper', name: 'Copper', limits: complianceLimits.heavyMetals.copper, unit: 'mg/L' },
        { id: 'lead', name: 'Lead', limits: complianceLimits.heavyMetals.lead, unit: 'mg/L' },
        { id: 'mercury', name: 'Mercury', limits: complianceLimits.heavyMetals.mercury, unit: 'mg/L' },
        { id: 'nickel', name: 'Nickel', limits: complianceLimits.heavyMetals.nickel, unit: 'mg/L' },
        { id: 'zinc', name: 'Zinc', limits: complianceLimits.heavyMetals.zinc, unit: 'mg/L' },
    ];

    const conventionalParams = [
        { id: 'ph', name: 'pH', limits: complianceLimits.conventional.ph, isRange: true },
        { id: 'temp_diff', name: 'Temperature Difference (Δ°C)', limits: complianceLimits.conventional.temp_diff, unit: '°C' },
        { id: 'e_coli', name: 'E.coli', limits: complianceLimits.conventional.e_coli, unit: 'MPN/100-ml' },
        { id: 'bod5', name: 'BOD5', limits: complianceLimits.conventional.bod5, unit: 'mg/L' },
        { id: 'cod', name: 'COD', limits: complianceLimits.conventional.cod, unit: 'mg/L' },
        { id: 'tss', name: 'TSS', limits: complianceLimits.conventional.tss, unit: 'mg/L' },
        { id: 'aox', name: 'AOX', limits: complianceLimits.conventional.aox, unit: 'mg/L' },
        { id: 'oil_grease', name: 'Oil and Grease', limits: complianceLimits.conventional.oil_grease, unit: 'mg/L' },
        { id: 'total_phenols', name: 'Total Phenols', limits: complianceLimits.conventional.total_phenols, unit: 'mg/L' },
        { id: 'total_nitrogen', name: 'Total Nitrogen', limits: complianceLimits.conventional.total_nitrogen, unit: 'mg/L' },
        { id: 'total_phosphorus', name: 'Total Phosphorus', limits: complianceLimits.conventional.total_phosphorus, unit: 'mg/L' },
        { id: 'sulphide', name: 'Sulphide', limits: complianceLimits.conventional.sulphide, unit: 'mg/L' },
    ];

    const sludgeParams = [
        { id: 'np_sludge', name: 'Nonylphenol (Sludge)', limits: complianceLimits.sludge.np, unit: 'mg/kg' },
        { id: 'pcp_sludge', name: 'PCP (Sludge)', limits: complianceLimits.sludge.pcp, unit: 'mg/kg' },
        { id: 'arsenic_sludge', name: 'Arsenic (Sludge)', limits: complianceLimits.sludge.arsenic_sludge, unit: 'mg/kg' },
        { id: 'chromiumVI_sludge', name: 'Chromium (VI) (Sludge)', limits: complianceLimits.sludge.chromiumVI_sludge, unit: 'mg/kg' },
        { id: 'mercury_sludge', name: 'Mercury (Sludge)', limits: complianceLimits.sludge.mercury_sludge, unit: 'mg/kg' },
        { id: 'ph_sludge', name: 'pH (Sludge)', limits: complianceLimits.sludge.ph_sludge, isRange: true },
        { id: 'faecal_coliform', name: 'Faecal Coliform (Sludge)', limits: complianceLimits.sludge.faecal_coliform, unit: 'MPN/g' }
    ];

    // Function to check compliance
    const checkCompliance = () => {
        const newResults = [];
        let allCompliant = true;
        const newChartData = [];

        // Helper function to add result and update overall compliance
        const addResult = (paramName, value, limit, isCompliant, unit = '') => {
            const limitDisplay = (typeof limit === 'object' && limit !== null) ? `${limit.min}-${limit.max}` : limit;
            newResults.push({
                paramName,
                value: value !== null ? value : 'N/A',
                limit: limitDisplay,
                isCompliant,
                unit
            });
            if (!isCompliant) {
                allCompliant = false;
            }
        };

        // --- ZDHC MRSL Parameters ---
        mrslParams.forEach(p => {
            const value = getInputValue(p.id);
            const limit = getLimit(p.limits);
            const isCompliant = value !== null && limit !== null ? value <= limit : true;
            addResult(p.name, value, limit, isCompliant, p.unit);
            if (value !== null && limit !== null) newChartData.push({ id: p.id, name: p.name, value: value, limit: limit, unit: p.unit });
        });

        // --- Heavy Metals ---
        heavyMetalParams.forEach(p => {
            const value = getInputValue(p.id);
            const limit = getLimit(p.limits);
            const isCompliant = value !== null && limit !== null ? value <= limit : true;
            addResult(p.name, value, limit, isCompliant, p.unit);
            if (value !== null && limit !== null) newChartData.push({ id: p.id, name: p.name, value: value, limit: limit, unit: p.unit });
        });

        // --- Conventional Parameters ---
        conventionalParams.forEach(p => {
            const value = getInputValue(p.id);
            const limit = getLimit(p.limits);
            let isCompliant;
            if (p.isRange) { // Special handling for pH
                isCompliant = value !== null && limit !== null ? (value >= limit.min && value <= limit.max) : true;
                addResult(p.name, value, limit, isCompliant);
                if (value !== null && limit !== null) newChartData.push({ id: p.id, name: p.name, value: value, limit: limit.max, minLimit: limit.min, unit: p.unit });
            } else {
                isCompliant = value !== null && limit !== null ? value <= limit : true;
                addResult(p.name, value, limit, isCompliant, p.unit);
                if (value !== null && limit !== null) newChartData.push({ id: p.id, name: p.name, value: value, limit: limit, unit: p.unit });
            }
        });

        // --- Sludge Parameters (Simplified) ---
        sludgeParams.forEach(p => {
            const value = getInputValue(p.id);
            const limit = getLimit(p.limits); // Sludge currently only has 'F' level
            let isCompliant;
            if (p.isRange) {
                isCompliant = value !== null && limit !== null ? (value >= limit.min && value <= limit.max) : true;
                addResult(p.name, value, limit, isCompliant);
            } else {
                isCompliant = value !== null && limit !== null ? value <= limit : true;
                addResult(p.name, value, limit, isCompliant, p.unit);
            }
            // No charts for sludge in this version to keep chart complexity manageable
        });

        setResults(newResults);
        setOverallCompliant(allCompliant);
        setChartData(newChartData);
        setShowResults(true);
    };

    // --- Firebase Save/Load Functions ---
    const saveResults = async () => {
        if (!isAuthReady || !db || !userId) {
            setMessage("Authentication not ready. Please wait or refresh.");
            return;
        }

        try {
            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
            const docRef = doc(db, `artifacts/${appId}/users/${userId}/compliance_data`, 'latest');
            await setDoc(docRef, {
                params: params,
                industryType: industryType,
                complianceLevel: complianceLevel,
                dischargeType: dischargeType,
                timestamp: new Date().toISOString()
            });
            setMessage("Data saved successfully!");
        } catch (e) {
            console.error("Error saving document: ", e);
            setMessage(`Error saving data: ${e.message}`);
        }
    };

    const loadResults = async () => {
        if (!isAuthReady || !db || !userId) {
            setMessage("Authentication not ready. Please wait or refresh.");
            return;
        }

        try {
            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
            const docRef = doc(db, `artifacts/${appId}/users/${userId}/compliance_data`, 'latest');
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const loadedData = docSnap.data();
                setParams(loadedData.params || {});
                setIndustryType(loadedData.industryType || 'T');
                setComplianceLevel(loadedData.complianceLevel || 'F');
                setDischargeType(loadedData.dischargeType || 'Direct');
                setMessage("Data loaded successfully!");
                // Re-run compliance check with loaded data to update results and charts
                // Use a ref to call checkCompliance after state update
                setTimeout(() => checkCompliance(), 0);
            } else {
                setMessage("No saved data found for this user.");
            }
        } catch (e) {
            console.error("Error loading document: ", e);
            setMessage(`Error loading data: ${e.message}`);
        }
    };

    const exportData = () => {
        const dataToExport = {
            params: params,
            results: results,
            industryType: industryType,
            complianceLevel: complianceLevel,
            dischargeType: dischargeType,
            overallCompliant: overallCompliant,
            timestamp: new Date().toISOString()
        };
        const jsonString = JSON.stringify(dataToExport, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `zdhc_compliance_report_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setMessage("Data exported as JSON.");
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4 sm:px-6 lg:px-8 font-sans">
            <div className="max-w-4xl w-full bg-white rounded-2xl shadow-xl p-8 sm:p-10">
                <h1 className="text-center text-4xl font-extrabold text-gray-800 mb-8 tracking-tight">
                    ZDHC Wastewater Compliance Checker
                </h1>

                <div className="disclaimer mt-8 text-sm text-gray-700 text-center p-4 bg-blue-50 border border-blue-200 rounded-xl shadow-sm">
                    This tool provides a compliance check based on the ZDHC Wastewater Guidelines V2.2. It includes Foundational, Progressive, and Aspirational limits for Textile and Leather industries. Sludge parameters are simplified. Always refer to the official ZDHC Wastewater Guidelines V2.2 document for complete and accurate information.
                    <p className="mt-2 font-semibold">Your User ID: <span className="text-blue-700 break-all">{userId}</span></p>
                </div>

                {message && (
                    <div className="mt-4 p-3 text-center text-sm font-medium bg-yellow-100 text-yellow-800 rounded-lg">
                        {message}
                    </div>
                )}

                <div className="input-section mt-10">
                    <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b-2 border-blue-600 pb-3">Configuration</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div>
                            <label htmlFor="industryType" className="block text-gray-700 font-medium mb-1">Industry Type</label>
                            <select id="industryType" value={industryType} onChange={(e) => setIndustryType(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm">
                                <option value="T">Textile</option>
                                <option value="L">Leather</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="complianceLevel" className="block text-gray-700 font-medium mb-1">Compliance Level</label>
                            <select id="complianceLevel" value={complianceLevel} onChange={(e) => setComplianceLevel(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm">
                                <option value="F">Foundational</option>
                                <option value="P">Progressive</option>
                                <option value="A">Aspirational</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="dischargeType" className="block text-gray-700 font-medium mb-1">Discharge Type</label>
                            <select id="dischargeType" value={dischargeType} onChange={(e) => setDischargeType(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm">
                                <option value="Direct">Direct Discharge</option>
                                <option value="Indirect">Indirect Discharge (with/without pretreatment)</option>
                                <option value="ZLD">Zero Liquid Discharge (ZLD)</option>
                            </select>
                        </div>
                    </div>

                    {/* MRSL Section */}
                    <div className="mb-8 p-6 bg-white rounded-xl shadow-md">
                        <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b-2 border-blue-600 pb-3 cursor-pointer flex justify-between items-center" onClick={() => setIsMrslOpen(!isMrslOpen)}>
                            ZDHC MRSL Substances (<span className="font-mono">&mu;g/L</span>)
                            <span className="text-blue-600 text-xl">{isMrslOpen ? '−' : '+'}</span>
                        </h2>
                        {isMrslOpen && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* MRSL Parameters */}
                                {mrslParams.map(p => {
                                    const currentLimit = getLimit(p.limits);
                                    const placeholderValue = currentLimit !== null ? `${(currentLimit * 0.8).toFixed(2)}` : '';
                                    const titleText = currentLimit !== null ? `Limit: ${currentLimit} ${p.unit}` : 'Limit: N/A';
                                    return (
                                        <div className="input-group" key={p.id}>
                                            <label htmlFor={p.id} className="block text-gray-700 font-medium mb-1" title={titleText}>
                                                {p.name}
                                            </label>
                                            <input type="number" id={p.id} value={params[p.id]} onChange={handleChange} placeholder={`e.g., ${placeholderValue}`}
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm" />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Heavy Metals Section */}
                    <div className="mb-8 p-6 bg-white rounded-xl shadow-md">
                        <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b-2 border-blue-600 pb-3 cursor-pointer flex justify-between items-center" onClick={() => setIsHeavyMetalsOpen(!isHeavyMetalsOpen)}>
                            Heavy Metals (<span className="font-mono">mg/L</span>)
                            <span className="text-blue-600 text-xl">{isHeavyMetalsOpen ? '−' : '+'}</span>
                        </h2>
                        {isHeavyMetalsOpen && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Heavy Metals Parameters */}
                                {heavyMetalParams.map(p => {
                                    const currentLimit = getLimit(p.limits);
                                    const placeholderValue = currentLimit !== null ? `${(currentLimit * 0.8).toFixed(2)}` : '';
                                    const titleText = currentLimit !== null ? `Limit (${industryType}, ${complianceLevel}): ${currentLimit} ${p.unit}` : 'Limit: N/A';
                                    return (
                                        <div className="input-group" key={p.id}>
                                            <label htmlFor={p.id} className="block text-gray-700 font-medium mb-1" title={titleText}>
                                                {p.name}
                                            </label>
                                            <input type="number" id={p.id} value={params[p.id]} onChange={handleChange} placeholder={`e.g., ${placeholderValue}`}
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm" />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Conventional Parameters Section */}
                    <div className="mb-8 p-6 bg-white rounded-xl shadow-md">
                        <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b-2 border-blue-600 pb-3 cursor-pointer flex justify-between items-center" onClick={() => setIsConventionalOpen(!isConventionalOpen)}>
                            Conventional Parameters (Discharged Wastewater)
                            <span className="text-blue-600 text-xl">{isConventionalOpen ? '−' : '+'}</span>
                        </h2>
                        {isConventionalOpen && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Conventional Parameters */}
                                {conventionalParams.map(p => {
                                    const currentLimit = getLimit(p.limits);
                                    const placeholderValue = p.isRange && currentLimit ? `${currentLimit.min}-${currentLimit.max}` : (currentLimit !== null ? `${(currentLimit * 0.8).toFixed(2)}` : '');
                                    const titleText = p.isRange && currentLimit ?
                                        `Limit (${industryType}, ${complianceLevel}): ${currentLimit.min}-${currentLimit.max} ${p.unit || ''}` :
                                        `Limit (${industryType}, ${complianceLevel}): ${currentLimit !== null ? currentLimit : 'N/A'} ${p.unit || ''}`;
                                    return (
                                        <div className="input-group" key={p.id}>
                                            <label htmlFor={p.id} className="block text-gray-700 font-medium mb-1" title={titleText}>
                                                {p.name}
                                            </label>
                                            <input type="number" id={p.id} step={p.id === 'ph' ? '0.1' : 'any'} value={params[p.id]} onChange={handleChange}
                                                placeholder={`e.g., ${placeholderValue}`}
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm" />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Sludge Parameters Section (Simplified) */}
                    <div className="mb-8 p-6 bg-white rounded-xl shadow-md">
                        <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b-2 border-blue-600 pb-3 cursor-pointer flex justify-between items-center" onClick={() => setIsSludgeOpen(!isSludgeOpen)}>
                            Sludge Parameters (Simplified)
                            <span className="text-blue-600 text-xl">{isSludgeOpen ? '−' : '+'}</span>
                        </h2>
                        {isSludgeOpen && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Sludge Parameters */}
                                {sludgeParams.map(p => {
                                    const currentLimit = getLimit(p.limits);
                                    const placeholderValue = p.isRange && currentLimit ? `${currentLimit.min}-${currentLimit.max}` : (currentLimit !== null ? `${(currentLimit * 0.8).toFixed(2)}` : '');
                                    const titleText = p.isRange && currentLimit ?
                                        `Limit: ${currentLimit.min}-${currentLimit.max} ${p.unit || ''}` :
                                        `Limit: ${currentLimit !== null ? currentLimit : 'N/A'} ${p.unit || ''}`;
                                    return (
                                        <div className="input-group" key={p.id}>
                                            <label htmlFor={p.id} className="block text-gray-700 font-medium mb-1" title={titleText}>
                                                {p.name}
                                            </label>
                                            <input type="number" id={p.id} step={p.id.includes('ph') ? '0.1' : 'any'} value={params[p.id]} onChange={handleChange}
                                                placeholder={`e.g., ${placeholderValue}`}
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm" />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>


                    <div className="flex flex-col sm:flex-row justify-center gap-4 mt-10">
                        <button
                            className="bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg hover:bg-blue-800 transition duration-300 ease-in-out transform hover:-translate-y-1"
                            onClick={checkCompliance}
                        >
                            Check Compliance
                        </button>
                        <button
                            className="bg-gray-600 text-white font-bold py-3 px-8 rounded-xl shadow-lg hover:bg-gray-700 transition duration-300 ease-in-out transform hover:-translate-y-1"
                            onClick={saveResults}
                            disabled={!isAuthReady}
                        >
                            Save Results
                        </button>
                        <button
                            className="bg-gray-600 text-white font-bold py-3 px-8 rounded-xl shadow-lg hover:bg-gray-700 transition duration-300 ease-in-out transform hover:-translate-y-1"
                            onClick={loadResults}
                            disabled={!isAuthReady}
                        >
                            Load Results
                        </button>
                        <button
                            className="bg-gray-600 text-white font-bold py-3 px-8 rounded-xl shadow-lg hover:bg-gray-700 transition duration-300 ease-in-out transform hover:-translate-y-1"
                            onClick={exportData}
                            disabled={!showResults} // Disable export if no results are shown
                        >
                            Export Data (JSON)
                        </button>
                    </div>
                </div>

                {showResults && (
                    <div className="results mt-12 p-8 bg-gray-50 border border-gray-200 rounded-2xl shadow-inner">
                        <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b-2 border-blue-600 pb-3">Compliance Results</h2>
                        <div className="space-y-4">
                            {results.map((result, index) => (
                                <div key={index} className="result-item flex flex-col sm:flex-row justify-between items-start sm:items-center py-3 border-b border-gray-200 last:border-b-0">
                                    <span className="text-gray-800 font-medium text-lg">{result.paramName}: {result.value}{result.unit}</span>
                                    <span className="text-gray-600 text-md mt-1 sm:mt-0">Limit: {result.limit}{result.unit}</span>
                                    <span className={result.isCompliant ? 'text-green-600 font-bold text-lg mt-2 sm:mt-0' : 'text-red-600 font-bold text-lg mt-2 sm:mt-0'}>
                                        {result.isCompliant ? 'COMPLIANT' : 'NON-COMPLIANT'}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="overall-status mt-8 text-center text-2xl font-extrabold">
                            <span className={overallCompliant ? 'text-green-700' : 'text-red-700'}>
                                Overall: {overallCompliant ? 'All entered parameters are COMPLIANT!' : 'Some parameters are NON-COMPLIANT. Please review.'}
                            </span>
                        </div>

                        {/* Charts Section */}
                        <h2 className="text-2xl font-bold text-gray-800 mt-12 mb-6 border-b-2 border-blue-600 pb-3">Compliance Charts</h2>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* Chart for MRSL & Heavy Metals */}
                            <div className="chart-container bg-white p-6 rounded-xl shadow-lg">
                                <h3 className="text-lg font-semibold text-gray-800 mb-4">MRSL & Heavy Metals Compliance</h3>
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={chartData.filter(d => Object.keys(complianceLimits.mrsl).includes(d.id) || Object.keys(complianceLimits.heavyMetals).includes(d.id))}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                                        <XAxis dataKey="name" stroke="#4a5568" />
                                        <YAxis stroke="#4a5568" />
                                        <Tooltip formatter={(value, name, props) => [`${value} ${props.payload.unit}`, name]} />
                                        <Legend />
                                        <Bar dataKey="value" name="Your Value" fill="#007bff" radius={[8, 8, 0, 0]} /> {/* Primary blue */}
                                        <Bar dataKey="limit" name="ZDHC Limit" fill="#a0aec0" radius={[8, 8, 0, 0]} /> {/* Gray for limits */}
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Chart for Conventional Parameters */}
                            <div className="chart-container bg-white p-6 rounded-xl shadow-lg">
                                <h3 className="text-lg font-semibold text-gray-800 mb-4">Conventional Parameters Compliance</h3>
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={chartData.filter(d => Object.keys(complianceLimits.conventional).includes(d.id))}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                                        <XAxis dataKey="name" stroke="#4a5568" />
                                        <YAxis stroke="#4a5568" />
                                        <Tooltip formatter={(value, name, props) => [`${value} ${props.payload.unit}`, name]} />
                                        <Legend />
                                        <Bar dataKey="value" name="Your Value" fill="#2f855a" radius={[8, 8, 0, 0]} /> {/* Green for conventional */}
                                        <Bar dataKey="limit" name="ZDHC Limit" fill="#a0aec0" radius={[8, 8, 0, 0]} /> {/* Gray for limits */}
                                        {/* For pH, add a reference line for the min limit */}
                                        <ReferenceLine y={complianceLimits.conventional.ph[industryType][complianceLevel].min} stroke="#e53e3e" strokeDasharray="3 3" label={{ position: 'top', value: 'pH Min Limit', fill: '#e53e3e', fontSize: 12 }} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
