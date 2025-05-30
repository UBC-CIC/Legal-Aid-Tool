import { useEffect, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import {
  Button,
  TextField,
  Card,
  Typography,
  CircularProgress, 
  IconButton,
  CardContent,
  Divider
} from "@mui/material";

import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import AdminHeader from "../../components/AdminHeader";

export default function Disclaimer() {
  const [currentDisclaimer, setCurrentDisclaimer] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastUpdated, setLastUpdated] = useState("");
  const [updatedBy, setUpdatedBy] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previousDisclaimers, setPreviousDisclaimers] = useState([]);
  const [restoring, setRestoring] = useState(false);

  const fetchDisclaimer = async () => {
    setLoading(true);
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;

      const response = await fetch(`${import.meta.env.VITE_API_ENDPOINT}admin/disclaimer`, {
        method: "GET",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();
      console.log(data[0]);
      if (data[0]?.disclaimer_text) {
        setCurrentDisclaimer(data[0].disclaimer_text);
        setLastUpdated(data[0].last_updated);
        setUpdatedBy(`${data[0].first_name} ${data[0].last_name}`);
        setPreviousDisclaimers(data.slice(1));
      }
    } catch (err) {
      console.error("Failed to fetch disclaimer:", err);
    } finally {
      setLoading(false);
    }
  };

  const restoreDisclaimer = async () => {
      setRestoring(true);
  
      const session = await fetchAuthSession();
      var token = session.tokens.idToken
      const cognito_id = session.tokens.idToken.payload.sub

      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT}admin/disclaimer?cognito_id=${cognito_id}`,
        {
          method: "POST",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            system_prompt: previousDisclaimers[currentIndex].disclaimer_text,
          }),
        }
      );
  
      fetchDisclaimer();
      
      setRestoring(false);
    };

  const saveDisclaimer = async () => {
    setSaving(true);
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;
      const cognito_id = session.tokens.idToken.payload.sub;

      await fetch(`${import.meta.env.VITE_API_ENDPOINT}admin/disclaimer?cognito_id=${cognito_id}`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ disclaimer_text: currentDisclaimer }),
      });

      await fetchDisclaimer();
    } catch (err) {
      console.error("Failed to save disclaimer:", err);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchDisclaimer();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <CircularProgress />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <AdminHeader />
      <Card
        sx={{
          marginTop: 10,
          padding: 3,
          border: "1px solid var(--border)",
          backgroundColor: "transparent",
        }}
      >
        <h1 style={{ fontSize: '30px', textAlign: 'left', marginBottom: "10px" }}><strong>Current Waiver</strong></h1>

        {lastUpdated && (
          <Typography
            variant="caption"
            sx={{ color: "#888", marginBottom: 1, display: "block", textAlign: "left" }}
          >
            Last updated: {new Date(lastUpdated).toLocaleString()}
          </Typography>
        )}

        <TextField
          value={currentDisclaimer}
          onChange={(e) => setCurrentDisclaimer(e.target.value)}
          fullWidth
          multiline
          rows={6}
          variant="outlined"
        />

        <Button
          onClick={saveDisclaimer}
          disabled={saving}
          sx={{
            backgroundColor: "var(--secondary)",
            color: "white",
            height: "40px",
            width: "100%",
            marginTop: "25px",
            marginBottom: "10px",
            "&:hover": {
              backgroundColor: "var(--primary)",
            },
            "&:disabled": {
              backgroundColor: "var(--border)",
              color: "white",
              cursor: "not-allowed",
            },
          }}
        >
          {saving ? "Saving..." : "Save Disclaimer"}
        </Button>
      </Card>

      {previousDisclaimers.length > 0 ? (
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
                 <h1 style={{ fontSize: '30px', margin: '10px' }}><strong>Previous Waivers</strong></h1>
      
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
                  onClick={() => setCurrentIndex((prev) => Math.min(prev + 1, previousDisclaimers.length - 1))}
                  disabled={currentIndex === previousDisclaimers.length - 1}
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
                <Typography variant="caption" sx={{ color: "var(--text-light)", marginTop: "5px", display: "block", textAlign: "left" }}>
                {new Date(previousDisclaimers[currentIndex].last_updated).toLocaleString()}
                  </Typography>
      
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-line' , textAlign: "left" }}>
                    {previousDisclaimers[currentIndex].disclaimer_text}
                  </Typography>
                  
                </CardContent>
      
                
              
              </Card>
              <div>
  <Button
    onClick={restoreDisclaimer}
    disabled={saving}
    sx={{
      backgroundColor: "var(--secondary)",
      color: "white",
      height: "40px",
      width: "100%",
      marginTop: "25px",
      marginBottom: "10px",
      "&:hover": {
        backgroundColor: "var(--primary)",
      },
      "&:disabled": {
        backgroundColor: "var(--border)",
        color: "white",
        cursor: "not-allowed",
      },
    }}
  >
    {restoring ? "Restoring..." : "Restore Disclaimer"}
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
