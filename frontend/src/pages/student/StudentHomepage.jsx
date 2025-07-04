import { useEffect, useState } from "react";
import StudentHeader from "../../components/StudentHeader";
import Container from "../Container";
import { ToastContainer } from "react-toastify";
import { Add, ArrowForward, MoreHoriz } from '@mui/icons-material';
import "react-toastify/dist/ReactToastify.css";
import { ring } from 'ldrs';
import { fetchAuthSession, fetchUserAttributes } from 'aws-amplify/auth'; 
import { AppBar } from "@mui/material";
import Disclaimer from "../../components/Disclaimer";
import DeleteIcon from '@mui/icons-material/Delete';
import ArchiveIcon from '@mui/icons-material/Archive';
ring.register();

import {
  Card,
  CardActions,
  CardContent,
  Button,
  Typography,
  Box,
  Grid,
  Stack,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Menu,
  MenuItem,
} from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { set } from "date-fns";
import zIndex from "@mui/material/styles/zIndex";

// MUI theming
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#546bdf',
      contrastText: '#050315',
    },
    secondary: {
      main: '#c5d6f0',
      contrastText: '#050315',
    },
    divider: '#1c187a',
    text: {
      primary: 'rgb(5, 3, 21)',
      secondary: 'rgba(5, 3, 21, 0.6)',
      disabled: 'rgba(5, 3, 21, 0.38)',
      hint: 'rgb(28, 24, 122)',
    },
    background: {
      default: '#fbfbfe',
    },
  },
});

export const StudentHomepage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState([]);
  const [error, setError] = useState(null); // For handling any errors during fetch
  const [openDialog, setOpenDialog] = useState(false); // Track if a dialog is open
  const [caseToDelete, setCaseToDelete] = useState(null); // Track which case to delete
  const [anchorEl, setAnchorEl] = useState(null); // For controlling the menu's anchor
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(true); // For tracking if the disclaimer is accepted
  const [selectedCaseId, setSelectedCaseId] = useState(null); // For tracking the selected case id

  // Handle opening the dialog
  const handleOpenDialog = (caseId) => {
    setCaseToDelete(caseId); // Set the caseId to delete
    setOpenDialog(true); // Open the dialog
  };

  // Handle closing the dialog (Cancel)
  const handleCloseDialog = () => {
    setOpenDialog(false); // Close the dialog
    setCaseToDelete(null); // Clear the case to delete
  };

  // Handle opening the menu for more options
  const handleMenuClick = (event, caseId) => {
    setAnchorEl(event.currentTarget); // Open the menu at the button's position
    setSelectedCaseId(caseId); // Store the selected case id
  };

  // Handle closing the menu
  const handleMenuClose = () => {
    setAnchorEl(null); // Close the menu
  };
  
  // Handle archive action from the menu
  const handleArchiveFromMenu = async (case_id) => {
    if (!case_id) return;

    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;
      const cognito_id = session.tokens.idToken.payload.sub;

      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT}student/archive_case?case_id=${case_id}&cognito_id=${cognito_id}`,
        {
          method: "PUT",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to delete the case");
      }
      handleMenuClose();
      // Remove deleted case from state
      setCases((prevCases) => prevCases.filter((caseItem) => caseItem.case_id !== selectedCaseId));
    } catch (error) {
      console.error("Error deleting case:", error);
    }
  };

  // Handle delete action from the menu
  const handleDeleteFromMenu = async () => {
    if (!selectedCaseId) return;

    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;
      const cognito_id = session.tokens.idToken.payload.sub;

      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT}student/delete_case?case_id=${selectedCaseId}&cognito_id=${cognito_id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to delete the case");
      }

      // Close the menu
      handleMenuClose();
      handleCloseDialog(); // Close the dialog
      setOpenDialog(false); // Close the dialog

      // Remove deleted case from state
      setCases((prevCases) => prevCases.filter((caseItem) => caseItem.case_id !== selectedCaseId));
    } catch (error) {
      console.error("Error deleting case:", error);
    }
  };

  useEffect(() => {
    const fetchCases = () => {
      fetchAuthSession()
        .then((session) => {
          return fetchUserAttributes().then((userAttributes) => {
            const token = session.tokens.idToken;
            const tokenstring = session.tokens.idToken.toString();
            const cognito_id = session.tokens.idToken.payload.sub;
            return fetch(
              `${
                import.meta.env.VITE_API_ENDPOINT
              }student/recent_cases?user_id=${cognito_id}`,
              {
                method: "GET",
                headers: {
                  Authorization: token,
                  "Content-Type": "application/json",
                },
              }
            );
          });
        })
        .then((response) => {
          if (response.status === 404) {
            setLoading(false);
            setCases([]); // Set cases to an empty array if no cases are found
            throw new Error("No cases found"); // Throw an error to be caught in the catch block
          }
  
          return response.json(); // Parse response JSON if not 404
        })
        .then((data) => {
          const activeCases = data.filter((c) => c.status !== "Archived");
          setCases(activeCases);
          setLoading(false);
        })
        .catch((error) => {
          console.error("Error fetching cases:", error);
        });
    };

    fetchCases();
  }, []);

  useEffect(() => {
    const checkDisclaimer = async () => {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens.idToken;
        const user_id = session.tokens.idToken.payload.sub;
        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT}student/disclaimer?user_id=${user_id}`,
          {
            method: "GET",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );
        const data = await response.json();
        setAcceptedDisclaimer(data[0]?.accepted_disclaimer);
      } catch (error) {
        console.error("Error fetching disclaimer status:", error);
      }
    }

    checkDisclaimer();
  }, []);

  const acceptDisclaimer = async ()=>{
    setAcceptedDisclaimer(true);
  }

  const handleViewCase = (caseId) => {
    navigate(`/case/${caseId}/overview`);
  };

  return (
    <div style={{}}>

      {!acceptedDisclaimer && (
        <div>
        <Disclaimer style={{zIndex: 1000}} onClick={acceptDisclaimer} />
        <StudentHeader />
        </div>
      )}

      {acceptedDisclaimer && (<div>
      <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh"}}>
        {/* Header */}
        <AppBar position="fixed" color="primary">
          <StudentHeader />
        </AppBar>

        {/* Main Content */}
        <Box sx={{ marginTop: 8, padding: 2, flexGrow: 1}}>

          <Container
            sx={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "flex-start",
              alignItems: "flex-start",
              width: "100%",
              maxWidth: "100%",
              pb: 0,
              gap: 2,
            }}
          >
            {/* Right Column: Cases */}
            <Box
              sx={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                paddingLeft: 3,
                paddingRight: 3,
                backgroundColor: 'var(--background)',
                overflowY: "auto"
              }}
            >
              {cases.length > 0 && (
                <Typography variant="h5" sx={{ textAlign: "left", fontWeight: 600, marginLeft: 3, marginTop: 5, color: "var(--header-text)", fontSize: "1.8rem", fontFamily: "Outfit" }}>
                  Recent Cases
                </Typography>
              )}
              <Stack sx={{ flex: 1, width: "100%" }}>
                {loading ? (
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      height: "80vh",
                      width: "100%",
                    }}
                  >
                    <l-ring size="50" stroke="4" speed="2" color="var(--text)"></l-ring>
                  </Box>
                ) : error ? (
                  <Box sx={{ textAlign: "center", mt: 2 }}>
                    <Typography variant="h6" sx={{ color: "red" }}>
                      {error}
                    </Typography>
                  </Box>
                ) : (
                  <Box
                    paddingLeft={3}
                    paddingRight={3}
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      justifyContent: "flex-start",
                      width: "100%",
                    }}
                  >

                    {cases.length === 0 ? (
                      <Typography
                        variant="body1"
                        sx={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: "translate(-50%, -50%)",
                          color: '#808080',
                          textAlign: "center",
                          mt: 2,
                          fontSize: "1.5rem",
                          fontFamily: "Outfit",
                        }}
                      >
                        No cases yet, start a new one
                      </Typography>
                    ) : (
                      <Grid container spacing={1} sx={{ width: "100%" }}>
                        {cases.map((caseItem, index) => (
                          <Grid item xs={12} sm={7.5} md={4} key={index}>
                            <Card
                              onClick={(event) => {
                                // Only trigger if the click was not on the button or menu
                                if (event.target.tagName !== "BUTTON" && !anchorEl) {
                                  handleViewCase(caseItem.case_id); // Trigger the redirection
                                }
                              }} // Ensure it doesn't trigger for the button or when the menu is open
                              sx={{
                                cursor: "pointer",
                                mb: 2,
                                mt: 2,
                                transition: "transform 0.3s ease",
                                "&:hover": { transform: "scale(1.01)" },
                                backgroundColor: "var(--background)",
                                color: "var(--text)",
                                boxShadow: "none",
                                border: "1px solid var(--border)",
                                display: "flex",
                                flexDirection: "column",
                                height: "90%",
                              }}
                            >
                              <CardContent
                                sx={{
                                  display: "flex",
                                  flexDirection: "column",
                                  height: "100%",
                                  textAlign: "left",
                                }}
                              >
                                <Typography
                                  sx={{
                                    color: "grey",
                                    fontSize: "0.85rem",
                                    fontWeight: 500,
                                  }}
                                >
                                  Case #{caseItem.case_hash}
                                </Typography>

                                <Box
                                  sx={{
                                    mb: 2,
                                    display: "flex",
                                    justifyContent: "flex-start",
                                    alignItems: "left",
                                  }}
                                >
                                  <Typography
                                    variant="h6"
                                    sx={{
                                      fontWeight: 600,
                                      fontSize: "1.25rem",
                                      textAlign: "left",
                                    }}
                                  >
                                    {caseItem.case_title}
                                  </Typography>
                                </Box>

                                {/* Status Section */}
                                <Typography
                                  variant="body1"
                                  sx={{
                                    textAlign: "left",
                                    fontWeight: 500,
                                    mb: 1,
                                    color: caseItem.status === "Review Feedback" ? "orange" : (caseItem.status === "Sent to Review" ? "var(--feedback)" : (caseItem.status == "In Progress" ? "var(--green-text)" : "#808080"))
                                  }}
                                >
                                  {caseItem.status}
                                </Typography>

                                {/* Case Type & Last Updated */}
                                <Typography
                                  variant="body2"
                                  sx={{ textAlign: "left", fontWeight: 400 }}
                                >
                                  <strong>Jurisdiction:</strong>{" "}
                                  {Array.isArray(caseItem.jurisdiction)
                                  ? caseItem.jurisdiction.join(", ")
                                  : caseItem.jurisdiction}
                                </Typography>

                                <Typography
                                  variant="body2"
                                  sx={{ textAlign: "left", fontWeight: 400 }}
                                >
                                  <strong>Date Added:</strong>{" "}
                                  {new Date(caseItem.last_updated).toLocaleString('en-US', {
                                    month: 'long',
                                    day: 'numeric', 
                                    year: 'numeric', 
                                    hour: 'numeric', 
                                    minute: 'numeric', 
                                    hour12: true, // Use 12-hour clock (e.g., 'AM')
                                  })}
                                </Typography>
                              </CardContent>

                              {/* 3-Dot Button and Menu */}
                              <CardActions sx={{ justifyContent: "flex-end", mt: 2 }}>
                                <Button
                                  size="small"
                                  onClick={(event) => {
                                    event.stopPropagation(); // Prevent the click from propagating to the Card's onClick handler
                                    event.preventDefault(); // Prevent any default behavior
                                    handleMenuClick(event, caseItem.case_id); // Trigger menu opening
                                  }}
                                  sx={{
                                    color: "gray",
                                    zIndex: 1000,
                                    ":hover": { background: "none" },
                                  }}
                                >
                                  <MoreHoriz /> {/* Ellipsis Icon */}
                                </Button>

                                <Menu
                                  anchorEl={anchorEl}
                                  open={Boolean(anchorEl)}
                                  onClose={handleMenuClose}
                                  PaperProps={{
                                    elevation: 0,
                                    sx: { boxShadow: "none", border: "1px solid var(--border)", backgroundColor: "var(--background3)", color:"var(--text)", fontFamily: "Outfit" },
                                  }}
                                >
                                  <MenuItem onClick={() => handleOpenDialog(caseItem.case_id)}>
                                    <DeleteIcon sx={{ mr: 1 }} />
                                    Delete
                                    </MenuItem>
                                  <MenuItem onClick={() => handleArchiveFromMenu(caseItem.case_id)}>
                                    <ArchiveIcon sx={{ mr: 1 }} />
                                    Archive
                                    </MenuItem>
                                </Menu>
                              </CardActions>
                            </Card>
                          </Grid>
                        ))}
                      </Grid>
                    )}
                  </Box>
                )}
              </Stack>
            </Box>
          </Container>
        </Box>

        <ToastContainer />
      </Box>

      {/* Dialog for confirmation */}
      <Dialog
        open={openDialog}
        onClose={handleCloseDialog}
        PaperProps={{ sx:{backgroundColor: 'var(--background)', color:"var(--text)", border: '1px solid var(--border)', fontFamily: "Outfit"} }}
      >
        <DialogTitle fontFamily={"Outfit"} fontWeight={'bold'}>Are you sure?</DialogTitle>
        <DialogContent>
          <Typography fontFamily={"Outfit"}>
            Are you sure you want to delete this case? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button sx={{color: "var(--text)", backgroundColor: "var(--background2)", textTransform: "none", borderRadius: 5, paddingX: 3, "&:hover":{backgroundColor:"var(--background)"}}} onClick={handleCloseDialog} color="primary">
            Cancel
          </Button>
          <Button onClick={handleDeleteFromMenu} sx={{color: "white", backgroundColor: "#fe3030", paddingX: 3, textTransform: "none", borderRadius: 5, '&:hover':{backgroundColor:'#d22'}}}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </div>)}
    </div>
  );
};

export default StudentHomepage;
