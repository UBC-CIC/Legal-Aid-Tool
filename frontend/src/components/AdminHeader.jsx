import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

// MUI Icons
import HomeIcon from "@mui/icons-material/Home";
import SettingsIcon from "@mui/icons-material/Settings";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import DescriptionIcon from "@mui/icons-material/Description";


// Amplify
import { signOut, fetchAuthSession, fetchUserAttributes } from "aws-amplify/auth";

const AdminHeader = () => {
  const [name, setName] = useState("");
  const [logo, setLogo] = useState("/logo_dark.svg");
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const navigate = useNavigate();
  const accountMenuRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    const fetchName = async () => {
      try {
        const session = await fetchAuthSession();
        const userAttributes = await fetchUserAttributes();
        const token = session.tokens.idToken;
        const email = userAttributes.email;

        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT}student/get_name?user_email=${encodeURIComponent(email)}`,
          {
            method: "GET",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );
        const data = await response.json();
        setName(data.name);
      } catch (error) {
        console.error("Error fetching name:", error);
      }
    };

    fetchName();
  }, []);

    const updateLogoBasedOnTheme = () => {
      const isDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setLogo(isDarkMode ? "/logo_dark.svg" : "/logo_light.svg");
    };
  
    useEffect(() => {
      updateLogoBasedOnTheme();
  
      const themeChangeListener = (e) => {
        updateLogoBasedOnTheme();
      };
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", themeChangeListener);
  
      return () => {
        window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", themeChangeListener);
      };
    }, []);

  // Optional: Theme-based logo switching
  // useEffect(() => {
  //   const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  //   const updateLogo = () => {
  //     setLogo(mediaQuery.matches ? "/logo_dark.svg" : "/logo_light.svg");
  //   };
  //   updateLogo();
  //   mediaQuery.addEventListener("change", updateLogo);
  //   return () => mediaQuery.removeEventListener("change", updateLogo);
  // }, []);

  const handleSignOut = async (event) => {
    event.preventDefault();
    try {
      await signOut();
      window.location.href = "/";
    } catch (error) {
      console.error("Error signing out: ", error);
    }
  };

  const toggleAccountMenu = () => {
    setIsAccountMenuOpen(!isAccountMenuOpen);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsAccountMenuOpen(false);
    }, 300);
  };

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  };

  return (
    <header
      className="bg-[var(--header)] p-4 flex justify-between items-center h-20 fixed top-0 left-0 w-full z-50 shadow-sm"
      style={{ fontFamily: 'Outfit, sans-serif' }}
    >

      <div className="flex items-center" style={{ fontFamily: 'Outfit' }}>
        <img src={logo} alt="Logo" className="h-14 w-14 mr-4" />
        <div style={{ textAlign: 'left' }}>
          <h2 className="text-xl text-[var(--text)] font-semibold">Legal Aid Tool</h2>
          <p className="text-sm text-[var(--text)]">Admin</p>
        </div>
      </div>

      <div className="flex items-center space-x-6">
        <button
          onClick={() => navigate("/home/*")}
          className="flex flex-col items-center bg-transparent text-[var(--header-text)] hover:text-gray-600 focus:outline-none transition-all duration-200"
        >
          <HomeIcon fontSize="large" />
          <span className="mt-1">Home</span>
        </button>

        <button
          onClick={() => navigate("/ai-control-panel")}
          className="flex flex-col items-center bg-transparent text-[var(--header-text)] hover:text-gray-600 focus:outline-none transition-all duration-200"
        >
          <SettingsIcon fontSize="large" />
          <span className="mt-1">AI Settings</span>
        </button>

        <button
          onClick={() => navigate("/disclaimer")}
          className="flex flex-col items-center bg-transparent text-[var(--header-text)] hover:text-gray-600 focus:outline-none transition-all duration-200"
        >
          <DescriptionIcon fontSize="large" />
          <span className="mt-1">Waiver</span>
        </button>

        {/* Account Menu */}
        <div
          className="relative"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <button
            onClick={toggleAccountMenu}
            className="flex flex-col bg-transparent items-center text-[var(--header-text)] hover:text-gray-600 focus:outline-none transition-all duration-200"
          >
            <AccountCircleIcon fontSize="large" />
            <span className="mt-1">{name}</span>
          </button>
          {isAccountMenuOpen && (
            <div
              ref={accountMenuRef}
              className="absolute right-0 bg-[var(--background)] shadow-lg w-48 p-2 rounded-lg"
            >
              <button
                onClick={handleSignOut}
                className="w-full text-left p-2 bg-[var(--background)] hover:bg-[var(--background2)]"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default AdminHeader;
