import React, { useState, useEffect, useRef } from "react";
import {
  Box, Typography, Container, Button, Stack, Divider, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Dialog, DialogTitle, DialogContent,
  DialogActions, IconButton, Menu, MenuItem, CircularProgress, TextField, Snackbar, Alert
} from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { jsPDF } from "jspdf";
import StudentHeader from "../../components/StudentHeader";
import InstructorHeader from "../../components/InstructorHeader";
import { fetchAuthSession } from "aws-amplify/auth";
import { marked } from "marked";
import CloseIcon from "@mui/icons-material/Close";
import DOMPurify from "dompurify";
import DownloadIcon from "@mui/icons-material/Download";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { v4 as uuidv4 } from "uuid";
import SideMenu from "./SideMenu";
import NotFound from "../NotFound";

const constructTranscriptionWebSocketUrl = (cognitoToken, audioFileId) => {
  const tempUrl = import.meta.env.VITE_GRAPHQL_WS_URL;
  const apiUrl = tempUrl.replace("https://", "wss://");
  const urlObj = new URL(apiUrl);
  urlObj.hostname = urlObj.hostname.replace("appsync-api", "appsync-realtime-api");
  const header = { host: new URL(tempUrl).hostname, Authorization: cognitoToken };
  const encodedHeader = btoa(JSON.stringify(header));
  return `${urlObj.toString()}?header=${encodedHeader}&payload=e30=`;
};

const Transcriptions = () => {
  const navigate = useNavigate();
  const {caseId} = useParams();
  const [transcriptions, setTranscriptions] = useState([]);
  const [userRole, setUserRole] = useState("student");
  const [caseData, setCaseData] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
const [selectedTranscription, setSelectedTranscription] = useState(null);
  const [snackbarMessage, setSnackbarMessage] = useState("");
  const [anchorEl, setanchorEl] = useState("");
  const [selectedTranscriptionId, setSelectedTranscriptionId] = useState(null);
  const wsRef = useRef(null);
  const [audioTitle, setAudioTitle] = useState("");

  const fetchTranscriptions = async () => {
    try {
      const { tokens } = await fetchAuthSession();
      const token = tokens.idToken
      const cognitoId = tokens.idToken.payload.sub;
      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT}student/get_transcriptions?case_id=${caseId}&cognito_id=${cognitoId}`,
        {
          method: "GET",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) throw new Error("Case not found");
      const data = await response.json();
      setTranscriptions(data);
    } catch (error) {
      console.error("Error fetching transcriptions:", error);
      setCaseData(null);
    }
  };


  useEffect(() => {
    const fetchCaseData = async () => {
      try {
        const { tokens } = await fetchAuthSession();
        const token = tokens.idToken;
        const cognitoId = tokens.idToken.payload.sub;
        const role = tokens.idToken.payload["cognito:groups"]?.[0] || "student";
        setUserRole(role);
        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT}student/case_page?case_id=${caseId}&cognito_id=${cognitoId}`,
          {
            method: "GET",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) throw new Error("Case not found");
        const data = await response.json();
        setCaseData(data.caseData);
        
      } catch (error) {
        console.error("Error fetching case data:", error);
        setCaseData(null);
      }
      setIsLoading(false);
    };

    fetchCaseData();
    fetchTranscriptions();
  }, [])

  const generatePresignedUrl = async (audioFileId) => {
    const fileName = audioFile.name;
    const fileType = audioFile.type;
    const { tokens } = await fetchAuthSession();
    const token = tokens.idToken;

    const response = await fetch(
      `${import.meta.env.VITE_API_ENDPOINT}student/generate_presigned_url?` +
      `audio_file_id=${encodeURIComponent(audioFileId)}&` +
      `file_name=${encodeURIComponent(fileName)}&` +
      `file_type=${encodeURIComponent(fileType)}`,
      {
        method: "GET",
        headers: { Authorization: token, "Content-Type": "application/json" },
      }
    );

    if (!response.ok) throw new Error("Failed to generate presigned URL");
    const data = await response.json();
    return data.presignedurl;
  };

  const initializeAudioFileInDb = async (audioFileId, fileName) => {
    const { tokens } = await fetchAuthSession();
    const token = tokens.idToken;
    const cognitoId = tokens.idToken.payload.sub;
    const s3FilePath = `${audioFileId}/${fileName}`;

    const response = await fetch(
      `${import.meta.env.VITE_API_ENDPOINT}student/initialize_audio_file?` +
      `audio_file_id=${encodeURIComponent(audioFileId)}&` +
      `s3_file_path=${encodeURIComponent(s3FilePath)}&` +
      `cognito_id=${encodeURIComponent(cognitoId)}&` +
      `case_id=${encodeURIComponent(caseId)}&` +
      `title=${encodeURIComponent(audioTitle)}` ,
      {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
      }
    );

    if (!response.ok) throw new Error("Failed to initialize audio file");
    const data = await response.json();
    return data;
  };

  const uploadFile = async (file, presignedUrl) => {
    const response = await fetch(presignedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) throw new Error("Upload failed");
    return response;
  };

  const audioToText = async (audioFileId) => {
    const fileName = audioFile.name;
    const fileType = audioFile.file.type;
    const fileExtension = audioFile.type;
    const { tokens } = await fetchAuthSession();
    const token = tokens.idToken;
    const cognitoToken = tokens.idToken.toString();
    const cognitoId = tokens.idToken.payload.sub;

    const response = await fetch(
      `${import.meta.env.VITE_API_ENDPOINT}student/audio_to_text?` +
      `audio_file_id=${encodeURIComponent(audioFileId)}&` +
      `file_name=${encodeURIComponent(fileName)}&` +
      `file_type=${encodeURIComponent(fileExtension)}&` +
      `cognito_token=${encodeURIComponent(cognitoToken)}`,
      {
        method: "GET",
        headers: { Authorization: token, "Content-Type": "application/json" },
      }
    );

    if (!response.ok) throw new Error("Failed to transcribe audio");
    const data = await response.json();
    return data.text;
  };

  const handleAudioUploading = async () => {
    if (isUploading || !audioFile) return;

    setIsUploading(true);
    setError(null);

    try {
      const audioFileId = uuidv4();
      const presignedUrl = await generatePresignedUrl(audioFileId);
      await uploadFile(audioFile.file, presignedUrl);
      await initializeAudioFileInDb(audioFileId, audioFile.name, audioTitle);
      audioToText(audioFileId);
      const { tokens } = await fetchAuthSession();
      const cognitoToken = tokens.idToken.toString();
      await setupWebSocket(cognitoToken, audioFileId);
      setSnackbarMessage("Transcription complete!");
      closeUploadDialog();
    } catch (error) {
      console.error("Upload error:", error);
      setError(error.message || "Failed to upload audio file");
    } finally {
      setIsUploading(false);
      setAudioTitle("");
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileNameWithoutExtension = file.name.replace(/\.[^/.]+$/, "");
    const fileTypeShort = file.type.split("/")[1];
    const normalizedType = fileTypeShort === "mpeg" ? "mp3" : fileTypeShort;

    setAudioFile({ file: file, name: fileNameWithoutExtension, type: normalizedType });
  };

  const openUploadDialog = () => {
    setUploadDialogOpen(true);
    setAudioFile(null);
    setError(null);
  };

  const closeUploadDialog = () => {
    setUploadDialogOpen(false);
    setAudioFile(null);
    setError(null);
  };

  

  const setupWebSocket = (cognitoToken, audioFileId) => {
    return new Promise((resolve, reject) => {
      const url = constructTranscriptionWebSocketUrl(cognitoToken, audioFileId);
  
      const ws = new WebSocket(url, "graphql-ws");
      wsRef.current = ws;
  
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "connection_init" }));
      };
  
      ws.onmessage = ({ data }) => {
        const msg = JSON.parse(data);
  
        if (msg.type === "connection_ack") {
          ws.send(JSON.stringify({
            id: audioFileId,
            type: "start",
            payload: {
              data: JSON.stringify({
                query: `subscription OnNotify($audioFileId: String!) {
                  onNotify(audioFileId: $audioFileId) {
                    message
                    audioFileId
                  }
                }`,
                variables: { audioFileId }
              }),
              extensions: {
                authorization: {
                  Authorization: cognitoToken,
                  host: new URL(import.meta.env.VITE_GRAPHQL_WS_URL).hostname
                }
              }
            }
          }));
        } else if (msg.type === "data" && msg.payload?.data?.onNotify?.message === "transcription_complete") {
          ws.close();
           // ✅ Refresh transcriptions in real-time
          fetchTranscriptions();
          resolve();
        } else if (msg.type === "error") {
          console.error("WebSocket subscription error:", msg);
          reject(new Error(`Subscription error: ${JSON.stringify(msg)}`));
        }
      };
  
      ws.onerror = (err) => {
        console.error("WebSocket encountered an error:", err);
        reject(err);
      };
  
      ws.onclose = () => {
        wsRef.current = null;
      };
    });
  };
  
  const fetchTranscriptionText = async (audioFileId) => {
    try {
      const { tokens } = await fetchAuthSession();
      const token = tokens.idToken;
      const cognitoId = tokens.idToken.payload.sub;
  
      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT}student/transcription?audio_file_id=${audioFileId}&cognito_id=${cognitoId}`,
        {
          method: "GET",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );
  
      if (!response.ok) throw new Error("Failed to fetch transcription text");
      const data = await response.json();
      return data.audio_text;
    } catch (error) {
      console.error("Error fetching transcription:", error);
      return "Error loading transcription.";
    }
  };
  
const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

const handleView = async (transcription) => {
  const audioText = await fetchTranscriptionText(transcription.audio_file_id);
  setSelectedTranscription({ ...transcription, audio_text: audioText });
  setViewDialogOpen(true);
};



const handleCloseView = () => {
  setViewDialogOpen(false);
  setSelectedTranscription(null);
};

const handleDownload = async (transcription) => {
  const audioText = await fetchTranscriptionText(transcription.audio_file_id);

  const doc = new jsPDF();
  const pageHeight = doc.internal.pageSize.height;
  const margin = 10;
  let y = margin;

  doc.setFontSize(12);
  y += 10;
  doc.text("Transcription:", margin, y);
  y += 10;

  const content = marked.parse(audioText).replace(/<[^>]+>/g, "");
  const lines = doc.splitTextToSize(content, 180);

  for (let i = 0; i < lines.length; i++) {
    if (y + 10 > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(lines[i], margin, y);
    y += 7;
  }

  doc.text(
    `Interview Date: ${new Date(transcription.timestamp).toLocaleString()}`,
    margin,
    y + 10
  );

  doc.save(
    `Case-${caseData.case_hash}:Transcription-${new Date(
      transcription.timestamp
    ).toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    })}.pdf`
  );
};

const openMenu = Boolean(anchorEl);

// open menu handler
const handleMenuOpen = (event, transcriptionId) => {
  setanchorEl(event.currentTarget);
  setSelectedTranscriptionId(transcriptionId);
};

// close menu handler
const handleMenuClose = () => {
  setanchorEl(null);
  setSelectedTranscriptionId(null);
};

// delete transcription handler
const handleDelete = async () => {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens.idToken;
    const cognitoId = session.tokens.idToken.payload.sub;
    const response = await fetch(
      `${import.meta.env.VITE_API_ENDPOINT}student/delete_transcription?audio_file_id=${selectedTranscriptionId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
      }
    );
    if (!response.ok) throw new Error("Failed to delete transcription");
    setTranscriptions((prev) => prev.filter((t) => t.audio_file_id !== selectedTranscriptionId));
  } catch (error) {
    console.error("Error deleting transcription:", error);
  } finally {
    setConfirmDeleteOpen(false);
    handleMenuClose();
  }
};

  return (
    <>
    {(caseData || isLoading)? (
    <Box display="flex" flexDirection="column" minHeight="100vh">
      <Box position="fixed" top={0} left={0} width="100%" zIndex={1000} bgcolor="white">
        {userRole === "instructor" ? <InstructorHeader /> : <StudentHeader />}
      </Box>

      <Box display="flex" pt="80px">
        <SideMenu />
        <Container sx={{ flexGrow: 1, p: 4, maxWidth: "900px", mx: "auto" }}>
          <Stack minHeight="100vh">
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
               {caseData && (
                            <div>
                            <Typography variant="h4" fontWeight={600} mb={0} fontFamily="Outfit" textAlign="left">
                            Transcriptions 
                            </Typography>
                            <Typography variant="h4" fontWeight={400} fontSize={20} mb={0} fontFamily="Outfit" textAlign="left">
                            For Case: "{caseData.case_title}"
                            </Typography>
                            
{caseData?.status === "Archived" && (
  <Typography sx={{ mt: 1, color: "gray", fontStyle: "italic", fontFamily: "Outfit" }}>
    This case is archived. Unarchive the case to upload new audio.
  </Typography>
)}
                            </div>
                          )}
                          <Stack>

<Button 
  variant="contained" 
  color="primary" 
  startIcon={<CloudUploadIcon />}
  onClick={openUploadDialog}
  disabled={caseData?.status === "Archived"}
  sx={{
    backgroundColor: caseData?.status === "Archived" ? "#ccc" : "var(--secondary)",
    color: "white",
    textTransform: "none",
    "&:hover": {
      backgroundColor: caseData?.status === "Archived" ? "#ccc" : "var(--primary)",
    },
    boxShadow: "none",
    borderRadius: 5,
    fontFamily: "Outfit",
  }}
>
  Upload Audio
</Button>
</Stack>
            </Stack>

            {transcriptions.length > 0 ? (
              <TableContainer component={Paper}>
                <Table>
                <TableHead>
  <TableRow>
    <TableCell>Interview Date</TableCell>
    <TableCell>Title</TableCell>
    <TableCell align="right"></TableCell>
  </TableRow>
</TableHead>

                  <TableBody>
                    {transcriptions.map((transcription) => (
                      <TableRow key={transcription.audio_file_id}>
                      <TableCell>
                        {new Date(transcription.timestamp).toLocaleString("en-US", {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "numeric",
                          hour12: true,
                        })}

                      </TableCell>
                      <TableCell>{transcription.file_title || "Untitled"}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          
                        <Button variant="outlined" 
                        sx={{
                          backgroundColor: "var(--secondary)",
                          color: "white",
                          textTransform: "none",
                          "&:hover": {
                            backgroundColor: "var(--primary)",
                          },
                          boxShadow: "none", // Optional: removes default MUI shadow
                          borderRadius: 5, // Optional: for consistent button shape
                          fontFamily: "Outfit", // Optional: if you're using this font
                        }}
                        onClick={() => handleView(transcription)}>
  View
</Button>
<Button
                            variant="contained"
                            startIcon={<DownloadIcon />}
                            onClick={() => handleDownload(transcription)}
                            sx={{
                              textTransform: "none",
                              backgroundColor: "var(--secondary)",
                              color: "white",
                              "&:hover": {
                                backgroundColor: "var(--primary)",
                              },
                              boxShadow: "none", // Optional: removes default MUI shadow
                              borderRadius: 5, // Optional: for consistent button shape
                              fontFamily: "Outfit", // Optional: if you're using this font
                            }}
                          >
                            Download
                          </Button>
                          <IconButton onClick={(e) => handleMenuOpen(e, transcription.audio_file_id)}>
  <MoreVertIcon />
</IconButton>
                        </Stack>
                      </TableCell>
                    </TableRow>
                    
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography variant="body2" color="gray">
                No transcriptions yet.
              </Typography>
            )}
          </Stack>
        </Container>
      </Box>

      {/* Audio Upload Dialog */}
      <Dialog 
        open={uploadDialogOpen} 
        onClose={closeUploadDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Upload Audio File
          <IconButton
            aria-label="close"
            onClick={closeUploadDialog}
            sx={{ position: "absolute", right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ p: 2 }}>
          <TextField
            fullWidth
            label="Audio Title"
            value={audioTitle}
            onChange={(e) => setAudioTitle(e.target.value)}
            sx={{ mb: 2 }}
            inputProps={{ maxLength: 100 }}
          />

            <Typography variant="body1" gutterBottom>
              Select an audio file to upload for transcription
            </Typography>
            
            {audioFile ? (
              <Box sx={{ mt: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: 1 }}>
                <Typography variant="subtitle1">Selected file:</Typography>
                <Typography>{audioFile.file.name} ({(audioFile.file.size / 1024 / 1024).toFixed(2)} MB)</Typography>
              </Box>
            ) : (
              <Box
                sx={{
                  mt: 2,
                  p: 3,
                  border: '2px dashed #e0e0e0',
                  borderRadius: 1,
                  textAlign: 'center',
                  cursor: 'pointer',
                  '&:hover': {
                    backgroundColor: '#f5f5f5',
                  },
                }}
                onClick={() => document.getElementById('audio-file-input').click()}
              >
                <input
                  id="audio-file-input"
                  type="file"
                  accept="audio/*"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
                <CloudUploadIcon sx={{ fontSize: 48, color: '#9e9e9e', mb: 1 }} />
                <Typography>Click to select an audio file or drag & drop here</Typography>
                <Typography variant="caption" color="textSecondary">
                  Supported formats: MP3, WAV, M4A, etc.
                </Typography>
              </Box>
            )}
            
            {error && (
              <Typography color="error" sx={{ mt: 2 }}>
                {error}
              </Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
  <Button onClick={closeUploadDialog} disabled={isUploading} sx={{ 
    textTransform: "none",
    backgroundColor: "var(--secondary)",
    color: "white",
    "&:hover": {
      backgroundColor: "var(--primary)",
    },
      borderRadius: 5, // Optional: for consistent button shape
      fontFamily: "Outfit", // Optional: if you're using this font 
      }}>
    Cancel
  </Button>
  <Button 
    variant="contained" 
    color="primary" 
    onClick={handleAudioUploading}
    disabled={!audioFile || isUploading}
    startIcon={isUploading ? <CircularProgress size={20} color="inherit" /> : null}
    sx={{
      textTransform: "none",
      backgroundColor: "var(--secondary)",
      color: "white",
      "&:hover": {
        backgroundColor: "var(--primary)",
      },
      boxShadow: "none", // Optional: removes default MUI shadow
      borderRadius: 5, // Optional: for consistent button shape
      fontFamily: "Outfit", // Optional: if you're using this font
    }}
  >
    {isUploading ? 'Processing...' : 'Upload & Transcribe'}
  </Button>
</DialogActions>

      </Dialog>

      {/* Menu */}
      <Menu anchorEl={anchorEl} open={openMenu} onClose={handleMenuClose}>
        <MenuItem
          onClick={() => {
            setConfirmDeleteOpen(true);
          }}
        >
          Delete
        </MenuItem>
      </Menu>

      {/* Delete Confirmation */}
      <Dialog open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)}>
        <DialogTitle>Are you sure?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} direction="row" justifyContent="flex-end" mt={2}>
            <Button onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>
            <Button color="error" onClick={handleDelete}>
              Delete
            </Button>
          </Stack>
        </DialogContent>
      </Dialog>

      


      {/* View Dialog */}
      <Dialog open={viewDialogOpen} onClose={handleCloseView} maxWidth="md" fullWidth>
        <DialogTitle
          sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pr: 6 }}
        >
          <Typography variant="h6" fontWeight={600}>
            Transcription Preview
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => handleDownload(selectedTranscription)}
                sx={{
                  backgroundColor: "var(--secondary)",
                  color: "white",
                  textTransform: "none",
                  "&:hover": {
                    backgroundColor: "var(--primary)",
                  },
                  boxShadow: "none",
                  padding: 1,
                  borderRadius: 5, 
                  fontFamily: "Outfit",
                }}
            >
              Download
            </Button>
            <IconButton
              aria-label="close"
              onClick={handleCloseView}
              sx={{ position: "absolute", right: 8, top: 8 }}
            >
              <CloseIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
  {selectedTranscription ? (
    <div
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(marked.parse(selectedTranscription.audio_text || "No transcription available")),
      }}
    />
  ) : (
    <Typography variant="body2">No transcription available</Typography>
  )}
</DialogContent>
      </Dialog>

      <Snackbar
  open={!!snackbarMessage}
  autoHideDuration={6000}
  onClose={() => setSnackbarMessage("")}
  anchorOrigin={{ vertical: "top", horizontal: "center" }}
>
  <Alert
    onClose={() => setSnackbarMessage("")}
    severity="success"
    sx={{ width: "100%" }}
  >
    {snackbarMessage}
  </Alert>
</Snackbar>

    </Box>)
    :
    (<NotFound/>)
          }
    </>
  );
};

export default Transcriptions;


