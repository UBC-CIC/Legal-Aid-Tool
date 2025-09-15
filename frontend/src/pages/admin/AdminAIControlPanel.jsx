import { useEffect, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import { Button, TextField, Card, CardContent, Typography, IconButton, Divider } from "@mui/material";
import AdminHeader from "../../components/AdminHeader";
import HistoryIcon from '@mui/icons-material/History';
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import { use } from "react";

export default function AIControlPanel() {
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [previousPrompts, setPreviousPrompts] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [messageLimit, setMessageLimit] = useState('10');
  const [noLimit, setNoLimit] = useState(true);

  const fetchCurrentPrompts = async () => {
    const session = await fetchAuthSession();
    var token = session.tokens.idToken
    const prompt = await fetch(
      `${import.meta.env.VITE_API_ENDPOINT}admin/prompt`,
      {
        method: "GET",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
      }
    );
    const data = await prompt.json();
    return data;
  };

  const fetchAndSetPrompts = async () => {
    setLoading(true);
    const allprompts = await fetchCurrentPrompts();
    
    if (allprompts.length > 0) {
      setCurrentPrompt(allprompts[0].prompt);
      setPreviousPrompts(allprompts.slice(1));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAndSetPrompts();
  }, []);

  useEffect(() => {
    const fetchMessageLimit = async () => {
      const session = await fetchAuthSession();
      var token = session.tokens.idToken
      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT}admin/message_limit`,
        {
          method: "GET",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );
      const data = await response.json();
      if (data.value !== 'Infinity') {
      setMessageLimit(data.value);
      setNoLimit(false);
      } else {
        setMessageLimit('0');
        setNoLimit(true);      
      }
      
    };

    fetchMessageLimit();
  }, []);

  const saveMessageLimit = async () => {
    setSaving(true);
    try{
     const session = await fetchAuthSession();
    var token = session.tokens.idToken
    const response = await fetch(
      `${import.meta.env.VITE_API_ENDPOINT}admin/message_limit`,
      {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          value: noLimit ? 'Infinity' : messageLimit,
        }),
      }
    ); 
    }
    catch (error) {
      console.error("Error saving message limit:", error);
    } finally {
      setSaving(false);
    }
  };
    


  const savePrompt = async () => {
    setSaving(true);

    const session = await fetchAuthSession();
    var token = session.tokens.idToken
    const response = await fetch(
      `${import.meta.env.VITE_API_ENDPOINT}admin/prompt`,
      {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_prompt: currentPrompt,
        }),
      }
    );

    fetchAndSetPrompts();
    
    setSaving(false);
  };

  const restorePrompt = async () => {
    setRestoring(true);

    const session = await fetchAuthSession();
    var token = session.tokens.idToken
    const response = await fetch(
      `${import.meta.env.VITE_API_ENDPOINT}admin/prompt`,
      {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_prompt: previousPrompts[currentIndex].prompt,
        }),
      }
    );

    fetchAndSetPrompts();
    
    setRestoring(false);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto p-4">
      <AdminHeader />

      {/* Message Limiter */}
      <Card sx={{ 
        marginTop: '80px', 
        background: "transparent", 
        color: "var(--text)", 
        border: "1px solid var(--border)", 
        boxShadow: 'none',
        display: 'flex', 
        flexDirection: 'column', 
        padding: '10px',
      }}>
<div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
  {/* Heading and description */}
  <div style={{ textAlign: 'left', color: 'var(--header-text)', margin: '17px', marginBottom: '0px' }}>
    <h1 style={{ fontSize: '30px' }}><strong>AI Assistant Daily Message Limit</strong></h1>
    <p style={{ marginTop: '5px' }}>
      Altering this will change the number of times each user can interact with the AI assistant per day.
    </p>
  </div>

  {/* No Limit toggle (right aligned) */}
  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginRight: '10px', gap: '10px' }}>
    <span style={{ fontSize: "0.9rem" }}>No Limit</span>
    <input
      type="checkbox"
      checked={noLimit}
      onChange={(e) => setNoLimit(e.target.checked)}
      style={{ transform: "scale(1.2)", cursor: "pointer" }}
    />
  </div>

  {/* Slider + number input */}
  <div style={{ display: 'flex', alignItems: 'center', gap: '15px', opacity: noLimit ? 0.5 : 1 }}>
    <input
      type="range"
      min="1"
      max="100"
      step="1"
      value={messageLimit > 100 ? 100 : messageLimit}
      onChange={(e) => !noLimit && setMessageLimit(parseInt(e.target.value))}
      style={{ flexGrow: 1 }}
      disabled={noLimit}
    />

<TextField
  type="number"
  value={noLimit ? "" : messageLimit}
  onChange={(e) => {
    if (noLimit) return;
    const val = parseInt(e.target.value);
    if (!isNaN(val) && val >= 1) {
      setMessageLimit(val);
    }
  }}
  inputProps={{ min: 1 }}
  disabled={noLimit}
  size="small"
  sx={{
    width: '95px',
    '& .MuiInputBase-input': {
      color: 'var(--text)',
      backgroundColor: 'var(--background)',
      padding: '6px 8px',
      borderRadius: 1,
    },
    '& .MuiOutlinedInput-root': {
      '& fieldset': {
        borderColor: 'var(--border)',
      },
      '&:hover fieldset': {
        borderColor: 'var(--primary)', // optional hover effect
      },
      '&.Mui-focused fieldset': {
        borderColor: 'var(--primary)',
      },
    }
  }}
/>
  </div>
  <Button
    onClick={saveMessageLimit}
    disabled={saving}
    sx={{
      backgroundColor: "var(--secondary)",
      color: "white",
      flexGrow: 1,
      height: "40px",
      "&:hover": { backgroundColor: "var(--primary)", opacity: 0.8 },
      "&:disabled": { backgroundColor: "var(--border)" }
    }}
  >
    {saving ? "Saving..." : "Save Message Limit"}
  </Button>
  
</div>


{/* Current Prompt */}
      </Card>
      <Divider sx={{borderColor: 'var(--border)', marginY: '15px'}} />
      <Card sx={{  
        background: "transparent", 
        color: "var(--text)", 
        border: "1px solid var(--border)", 
        boxShadow: 'none',
        display: 'flex', 
        flexDirection: 'column',  
        padding: '10px',
      }}>
        <div style={{ textAlign: 'left', color: 'var(--header-text)', margin: '17px', marginBottom: '0px' }}>
          <h1 style={{ fontSize: '30px' }}><strong>Current System Prompt</strong></h1>
          <p style={{marginTop: '5px'}}>This controls the instructions given to the AI assistant. Changing it will change its behaviour for <strong>all users.</strong></p>
        </div>

        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <TextField
            value={currentPrompt}
            onChange={(e) => setCurrentPrompt(e.target.value)}
            fullWidth
            multiline
            autoFocus
            variant="outlined"
             inputProps={{ maxLength: 10000 }}
             helperText={
    <span style={{ color: currentPrompt.length >= 10000 ? 'red' : 'inherit' }}>
      {currentPrompt.length}/10000 characters
    </span>
  }
            sx={{
              minHeight: "50px", 
              maxHeight: "none", 
              overflow: "hidden",
              padding: "10px",
              "& .MuiOutlinedInput-root": {
                borderColor: "var(--border)",
              },
              "& .MuiInputBase-input": {
                color: "var(--text)",
                lineHeight: 1.5,
                display: "block",
              },
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: "var(--border)",
              }
            }}
          />

          <div style={{ display: 'flex', width: '100%' }}>
            <Button
              onClick={savePrompt}
              disabled={saving}
              sx={{
                backgroundColor: "var(--secondary)",
                color: "white",
                flexGrow: 1,
                height: "40px",
                "&:hover": { backgroundColor: "var(--primary)", opacity: 0.8 },
                "&:disabled": { backgroundColor: "var(--border)" }
              }}
            >
              {saving ? "Saving..." : "Save Prompt"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {previousPrompts.length > 0 ? (
        <Card sx={{ 
          background: "transparent", 
          color: "var(--text)", 
          marginTop: '20px',
          border: "1px solid var(--border)", 
          boxShadow: 'none',
          alignItems: 'center',          
          paddingX: "35px",
          paddingY: "20px",
          textAlign: 'left',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', justifyContent: 'space-between' }}>
           {/* History Navigation */}
           <h1 style={{ fontSize: '30px', margin: '10px' }}><strong>Previous System Prompt</strong></h1>

           <div>
           <IconButton 
            onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}
            disabled={currentIndex === 0}
            sx={{
              color: "var(--text)",
              "&:disabled": { color: "var(--border)" }
            }}
          >
            <ArrowBackIosIcon />
          </IconButton>
          

          <IconButton 
            onClick={() => setCurrentIndex((prev) => Math.min(prev + 1, previousPrompts.length - 1))}
            disabled={currentIndex === previousPrompts.length - 1}
            sx={{
              color: "var(--text)",
              "&:disabled": { color: "var(--border)" }
            }}
          >
            <ArrowForwardIosIcon />
          </IconButton>
          </div>
          </div>
        <Card sx={{ 
          background: "transparent", 
          color: "var(--text)", 
          border: "1px solid var(--border)", 
          boxShadow: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          

          <CardContent sx={{ flexGrow: 1, textAlign: 'center' }}>
          <Typography variant="caption" sx={{ color: "var(--text-light)", marginTop: "5px", display: "block" }}>
              {previousPrompts[currentIndex].time_created}
            </Typography>

            <Typography variant="body1" sx={{ whiteSpace: 'pre-line' }}>
              {previousPrompts[currentIndex].prompt}
            </Typography>
            
          </CardContent>

          
        
        </Card>
        <div>       
        <Button
              onClick={restorePrompt}
              disabled={saving}
              sx={{
                backgroundColor: "var(--secondary)",
                color: "white",
                height: "40px",
                width: "100%",
                marginTop: "25px",
                marginBottom: "10px",
          
              }}
            >
              {restoring ? "Restoring..." : "Restore Prompt"}
            </Button>
            </div>
        </Card>
        
      ) : (
        <Typography variant="body1" sx={{ color: "#808080", textAlign: "center", marginTop: "20px" }}>
          No previous prompts available.
        </Typography>
        
      )}
      
    </div>
  );
}
