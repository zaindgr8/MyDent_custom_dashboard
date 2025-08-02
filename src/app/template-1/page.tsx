"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { getCurrentUser } from "@/lib/auth"
import { useRouter } from "next/navigation"
import AuthenticatedLayout from "../components/AuthenticatedLayout"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Eye, Upload, X, FileText, Users, Search } from "lucide-react"

interface CsvRow {
  phoneNumber: string
  customerName?: string
  metadata?: Record<string, string>
}

interface Patient {
  call_status: string
  date_for_post_op_follow_up: string
  created_at: string
  date_of_birth: string
  follow_up_appointment: string
  post_treatment_notes: string
  updated_at: string
  last_name: string
  treatment: string
  first_name: string
  post_ops_follow_up_notes: string
  phone_number: string
  post_op_call_status: string
  post_treatment_prescription: string
  patient_id: string
}

interface PatientModalData {
  patient: Patient
  field: string
  title: string
  content: string
}

export default function CreateCallsPage() {
  const [user, setUser] = useState<any>(null)
  const router = useRouter()

  // State declarations
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ call_id: string } | null>(null)

  // CSV related states
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvData, setCsvData] = useState<CsvRow[]>([])
  const [hasHeaders, setHasHeaders] = useState(true)
  const [activeTab, setActiveTab] = useState("archive")

  // Add state for patients data
  const [patients, setPatients] = useState<Patient[]>([])
  const [loadingPatients, setLoadingPatients] = useState(false)

  // Modal state
  const [modalData, setModalData] = useState<PatientModalData | null>(null)

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("")

  const [processingBatch, setProcessingBatch] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{
    total: number
    processed: number
    success: number
    failed: number
  }>({
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Initialize user and set default agent
  useEffect(() => {
    const currentUser = getCurrentUser()
    if (!currentUser) {
      router.push("/login")
      return
    }
    setUser(currentUser)
    // Auto-load patients when component mounts
    getAllPatients()
  }, [router])

  // Helper functions for content display
  const openModal = (patient: Patient, field: string, title: string, content: string) => {
    setModalData({ patient, field, title, content })
  }

  const truncateText = (text: string, maxLength = 25) => {
    if (!text || text.length <= maxLength) return text || "-"
    return text.substring(0, maxLength) + "..."
  }

  const renderCellContent = (content: string, patient: Patient, fieldName: string, title: string, maxLength = 25) => {
    if (!content || content === "not allowed") {
      return <span className="text-gray-400 italic">-</span>
    }

    const shouldTruncate = content.length > maxLength

    if (!shouldTruncate) {
      return <span className="text-gray-900">{content}</span>
    }

    return (
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-gray-900 truncate flex-1" title={content}>
          {truncateText(content, maxLength)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openModal(patient, fieldName, title, content)}
          className="h-6 w-6 p-0 text-blue-600 hover:text-blue-800 hover:bg-blue-50 flex-shrink-0"
        >
          <Eye className="h-3 w-3" />
        </Button>
      </div>
    )
  }

  const parseCSV = (text: string): CsvRow[] => {
    // Split by new lines
    const lines = text.split(/\r\n|\n/).filter((line) => line.trim().length > 0)
    if (lines.length === 0) return []

    // Determine the delimiter (comma or semicolon)
    const delimiter = lines[0].includes(";") ? ";" : ","

    // Helper function to parse CSV row with proper quote handling
    const parseCSVRow = (line: string): string[] => {
      const result: string[] = []
      let current = ''
      let inQuotes = false
      let i = 0

      while (i < line.length) {
        const char = line[i]
        
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            // Escaped quote
            current += '"'
            i += 2
          } else {
            // Toggle quote state
            inQuotes = !inQuotes
            i++
          }
        } else if (char === delimiter && !inQuotes) {
          // Field separator outside quotes
          result.push(current.trim())
          current = ''
          i++
        } else {
          current += char
          i++
        }
      }
      
      // Add the last field
      result.push(current.trim())
      return result
    }

    // Parse header row if present
    const startIndex = hasHeaders ? 1 : 0
    const headers = hasHeaders
      ? parseCSVRow(lines[0]).map((h) => h.trim().toLowerCase())
      : ["phone_number", "customer_name"]

    // Find column indices
    const phoneNumberIndex = headers.findIndex((h) => h.includes("phone") || h.includes("number") || h.includes("tel"))
    const firstNameIndex = headers.findIndex((h) => h.includes("first") && h.includes("name"))
    const lastNameIndex = headers.findIndex((h) => h.includes("last") && h.includes("name"))
    const nameIndex = headers.findIndex((h) => h.includes("name") && !h.includes("first") && !h.includes("last"))

    if (phoneNumberIndex === -1) {
      throw new Error("Could not identify phone number column in CSV")
    }

    // Field mapping for common variations
    const fieldMappings = {
      // Name fields - matching your CSV exactly
      first_name: ["firstname", "first name", "first_name", "fname"],
      last_name: ["lastname", "last name", "last_name", "lname", "surname"],
      // Date fields - matching your CSV exactly
      date_of_birth: ["dob", "date of birth", "birth date", "birthdate", "date_of_birth"],
      // Treatment fields - matching your CSV exactly
      treatment: ["treatment", "procedure", "service"],
      // Notes and prescription fields - matching your CSV exactly
      post_treatment_notes: ["posttreatment_notes", "post-treatment notes", "post treatment notes", "notes", "treatment notes", "post_treatment_notes"],
      post_treatment_prescription: ["posttreatment_prescription", "prescription", "post-treatment prescription", "post treatment prescription", "medication", "post_treatment_prescription", "post-treatment perscription"],
      // Follow-up fields - matching your CSV exactly
      follow_up_appointment: ["followup_appointment", "follow up appointment", "follow-up appointment", "followup", "next appointment", "follow_up_appointment"],
      post_ops_follow_up_notes: ["followup_notes", "follow up notes", "follow-up notes", "post-ops follow up notes", "post ops notes", "followup notes", "post_ops_follow_up_notes"],
      date_for_post_op_follow_up: ["followup_date", "date for post-op follow up", "follow up date", "followup date", "post op date", "date_for_post_op_follow_up"],
      // Status fields - matching your CSV exactly
      call_status: ["call status", "status", "call_status"],
      post_op_call_status: ["postfollowup_status", "post-op call status", "post op status", "follow up status", "post_op_call_status"]
    }

    // Helper function to find field index by mapping
    const findFieldIndex = (fieldMappings: string[]) => {
      return headers.findIndex(header => 
        fieldMappings.some(mapping => header.toLowerCase().includes(mapping.toLowerCase()))
      )
    }

    // Parse rows
    const parsedRows: CsvRow[] = []
    for (let i = startIndex; i < lines.length; i++) {
      const row = parseCSVRow(lines[i])

      // Debug logging for first few rows
      if (i <= startIndex + 2) {
        console.log(`=== ROW ${i} PARSING ===`)
        console.log("Raw line:", lines[i])
        console.log("Parsed row:", row)
        console.log("Headers:", headers)
        console.log("Header-Row mapping:")
        headers.forEach((header, index) => {
          console.log(`  ${index}: "${header}" = "${row[index] || 'undefined'}"`)
        })
      }

      // Skip empty rows
      if (row.every((cell) => cell === "")) continue

      // Extract phone number (required)
      const phoneNumber = row[phoneNumberIndex]
      if (!phoneNumber) continue

      // Extract names
      let firstName = ""
      let lastName = ""
      
      if (firstNameIndex !== -1) {
        firstName = row[firstNameIndex] || ""
      }
      if (lastNameIndex !== -1) {
        lastName = row[lastNameIndex] || ""
      }
      // Fallback to generic name field if specific first/last not found
      if (!firstName && !lastName && nameIndex !== -1) {
        const fullName = row[nameIndex] || ""
        const nameParts = fullName.split(" ")
        firstName = nameParts[0] || ""
        lastName = nameParts.slice(1).join(" ") || ""
      }

      // Extract mapped fields
      const metadata: Record<string, string> = {}
      
      // Map all patient fields
      Object.entries(fieldMappings).forEach(([fieldName, mappings]) => {
        const fieldIndex = findFieldIndex(mappings)
        if (fieldIndex !== -1 && row[fieldIndex]) {
          metadata[fieldName] = row[fieldIndex]
          console.log(`✅ MAPPED: ${fieldName} = "${row[fieldIndex]}" (from column ${fieldIndex}: "${headers[fieldIndex]}")`)
        } else {
          console.log(`❌ NOT FOUND: ${fieldName} - looking for: [${mappings.join(', ')}]`)
          console.log(`   Available headers: [${headers.join(', ')}]`)
        }
      })

      // Add any unmapped columns as additional metadata
      headers.forEach((header, index) => {
        if (index !== phoneNumberIndex && index !== firstNameIndex && index !== lastNameIndex && index !== nameIndex && row[index]) {
          // Check if this field is already mapped
          const isAlreadyMapped = Object.values(fieldMappings).some(mappings => 
            mappings.some(mapping => header.includes(mapping))
          )
          if (!isAlreadyMapped) {
            metadata[header] = row[index]
          }
        }
      })

      // Set first and last names in metadata if found
      if (firstName) metadata.first_name = firstName
      if (lastName) metadata.last_name = lastName

      parsedRows.push({
        phoneNumber,
        customerName: firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      })
    }
    return parsedRows
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setCsvFile(file)

      // Read file content
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const text = event.target?.result as string
          const parsedData = parseCSV(text)
          setCsvData(parsedData)
        } catch (error: any) {
          setError(`Failed to parse CSV: ${error.message}`)
        }
      }

      reader.onerror = () => {
        setError("Failed to read file")
      }

      reader.readAsText(file)
    } catch (err: any) {
      setError(`Failed to process CSV file: ${err.message}`)
    }
  }

  const cancelCSVImport = () => {
    setCsvData([])
    setCsvFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  // Process CSV batch with delays between calls
  const processCsvBatch = async () => {
    if (csvData.length === 0) {
      setError("No data to process")
      return
    }
    setProcessingBatch(true)
    setError(null)
    try {
      // Check for already called patients
      const alreadyCalledPatients = csvData.filter(row => 
        row.metadata?.call_status?.toLowerCase() === "called"
      )
      
      const notCalledPatients = csvData.filter(row => 
        !row.metadata?.call_status || row.metadata?.call_status?.toLowerCase() === "not-called"
      )

      // Show warnings for already called patients
      if (alreadyCalledPatients.length > 0) {
        console.warn("=== ALREADY CALLED PATIENTS ===")
        alreadyCalledPatients.forEach((patient, index) => {
          const name = `${patient.metadata?.first_name || ''} ${patient.metadata?.last_name || ''}`.trim()
          console.warn(`${index + 1}. ${name || 'Unknown'} (${patient.phoneNumber}) - Status: ${patient.metadata?.call_status}`)
        })
        
        const shouldContinue = confirm(
          `Warning: ${alreadyCalledPatients.length} patient(s) already have "called" status:\n\n` +
          alreadyCalledPatients.map((patient, index) => {
            const name = `${patient.metadata?.first_name || ''} ${patient.metadata?.last_name || ''}`.trim()
            return `${index + 1}. ${name || 'Unknown'} (${patient.phoneNumber})`
          }).join('\n') +
          `\n\nOnly ${notCalledPatients.length} patient(s) with "not-called" status will be processed.\n\nDo you want to continue?`
        )
        
        if (!shouldContinue) {
          setProcessingBatch(false)
          return
        }
      }

      // Only process patients with "not-called" status
      if (notCalledPatients.length === 0) {
        setError("No patients with 'not-called' status found to process")
        setProcessingBatch(false)
        return
      }

      // Map only not-called patients to the required call_patients format
      const call_patients = notCalledPatients.map((row) => ({
        call_status: "not-called",
        date_for_post_op_follow_up: row.metadata?.date_for_post_op_follow_up || "",
        created_at: new Date().toISOString(),
        date_of_birth: row.metadata?.date_of_birth || "",
        follow_up_appointment: row.metadata?.follow_up_appointment || "",
        post_treatment_notes: row.metadata?.post_treatment_notes || "",
        updated_at: new Date().toISOString(),
        last_name: row.metadata?.last_name || "",
        treatment: row.metadata?.treatment || "",
        first_name: row.metadata?.first_name || "",
        post_ops_follow_up_notes: row.metadata?.post_ops_follow_up_notes || "",
        phone_number: row.phoneNumber || "",
        post_op_call_status: row.metadata?.post_op_call_status || "not-called",
        post_treatment_prescription: row.metadata?.post_treatment_prescription || "",
        patient_id: row.metadata?.patient_id || "",
      }))

      // Log the exact data being sent to API
      
      const requestBody = { call_patients }
      if (call_patients.length > 0) {
        console.table(call_patients[0])
      }

      // Send the batch to your webhook as { call_patients: [...] }
      const response = await fetch(
        "https://n8n-app.eastus.cloudapp.azure.com:5678/webhook/64602fde-f5b2-4baf-b9a8-91d641ffe69c",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        },
      )

      // Log the raw response for debugging
      const respText = await response.text()
      
      if (!response.ok) {
        throw new Error(`Batch call API failed with status ${response.status}: ${respText}`)
      }
      
      const successMessage = alreadyCalledPatients.length > 0 
        ? `Batch submitted: ${call_patients.length} patients processed (${alreadyCalledPatients.length} already called patients skipped)`
        : `Batch submitted: ${call_patients.length} patients processed`
      
      setSuccess({ call_id: successMessage })
      setCsvData([])
      setCsvFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    } catch (error: any) {
      console.error("=== ERROR ===", error)
      setError(`Batch call failed: ${error.message}`)
    } finally {
      setProcessingBatch(false)
    }
  }

  // Function to fetch all patients (fixed data parsing)
  const getAllPatients = async () => {
    setLoadingPatients(true)
    setError(null)
    try {
      const endpoint = "https://n8yh3flwsc.execute-api.us-east-1.amazonaws.com/prod/api/nomads/patients"
      const payload = { action: "query" }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      const result = await response.json()

      if (response.ok) {
        let patientsData = null

        if (result && typeof result === "object") {
          // Handle the nested structure: result.data.patients
          if (result.success === true && result.data && result.data.patients) {
            patientsData = result.data.patients
          } else if (result.data && result.data.patients) {
            patientsData = result.data.patients
          } else if (result.patients) {
            patientsData = result.patients
          } else if (Array.isArray(result)) {
            patientsData = result
          }
        }

        if (patientsData && Array.isArray(patientsData)) {
          setPatients(patientsData)
        } else {
          console.error("Could not find patients array in response:", result)
          setError("No patient data found in API response")
          setPatients([])
        }
      } else {
        setError(`API Error (${response.status}): ${result.error || result.message || "Failed to fetch patients"}`)
        setPatients([])
      }
    } catch (err: any) {
      console.error("Fetch error:", err)
      setError(`Network error: ${err.message}`)
      setPatients([])
    } finally {
      setLoadingPatients(false)
    }
  }

  // Filter patients based on search query
  const filteredPatients = patients.filter((patient) => {
    if (!searchQuery.trim()) return true
    
    const searchTerm = searchQuery.toLowerCase()
    const searchableFields = [
      patient.first_name,
      patient.last_name,
      patient.phone_number,
      patient.treatment,
      patient.post_treatment_notes,
      patient.post_treatment_prescription,
      patient.post_ops_follow_up_notes,
      patient.date_of_birth,
      patient.follow_up_appointment,
      patient.call_status,
      patient.post_op_call_status
    ]
    
    return searchableFields.some(field => 
      field && field.toString().toLowerCase().includes(searchTerm)
    )
  })

  const getStatusBadge = (status: string) => {
    const variant = status === "called" ? "default" : "secondary"
    const className =
      status === "called"
        ? "bg-green-100 text-green-800 hover:bg-green-100"
        : "bg-yellow-100 text-yellow-800 hover:bg-yellow-100"

    return (
      <Badge variant={variant} className={className}>
        {status || "not-called"}
      </Badge>
    )
  }

  return (
    <AuthenticatedLayout>
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8 max-w-full">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Outbound Calls</h1>
            <p className="text-gray-600">Manage patient calls and batch uploads</p>
          </div>

          {/* Error and Success Messages */}
          {error && (
            <Card className="mb-6 border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-red-700">
                  <X className="h-5 w-5" />
                  <div>
                    <p className="font-semibold">Error</p>
                    <p className="text-sm">{error}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {success && (
            <Card className="mb-6 border-green-200 bg-green-50">
              <CardContent className="pt-6">
                <div className="text-green-700">
                  <p className="font-semibold">Call Created Successfully!</p>
                  <p className="text-sm">Call ID: {success.call_id}</p>
                  <p className="text-sm mt-1">You can track this call in the Call History page.</p>
                </div>
              </CardContent>
            </Card>
          )}

          {processingBatch && (
            <Card className="mb-6 border-blue-200 bg-blue-50">
              <CardContent className="pt-6">
                <div className="text-blue-700">
                  <p className="font-semibold mb-3">Processing Batch Calls</p>
                  <div className="space-y-2">
                    <p className="text-sm">
                      Progress: {batchProgress.processed} of {batchProgress.total} calls processed
                    </p>
                    <div className="w-full bg-blue-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(batchProgress.processed / batchProgress.total) * 100}%` }}
                      ></div>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span>Success: {batchProgress.success}</span>
                      <span>Failed: {batchProgress.failed}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="archive" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Archive ({patients.length})
              </TabsTrigger>
              <TabsTrigger value="batch" className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Batch Upload (CSV)
              </TabsTrigger>
            </TabsList>

            <TabsContent value="archive" className="space-y-6">
              <Card>
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between mb-4">
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      Patient Archive
                    </CardTitle>
                    <div className="text-sm text-gray-500">
                      {searchQuery ? `${filteredPatients.length} of ${patients.length} patients` : `${patients.length} patients total`}
                    </div>
                  </div>
                  <div className="relative max-w-md">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                    <input
                      type="text"
                      placeholder="Search patients by name, phone, treatment..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  {loadingPatients ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p className="text-gray-600 font-medium">Loading patients...</p>
                        <p className="text-gray-400 text-sm">Please wait while we fetch the data</p>
                      </div>
                    </div>
                  ) : filteredPatients.length === 0 ? (
                    <div className="text-center py-16">
                      <div className="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                        <Users className="h-12 w-12 text-gray-400" />
                      </div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2">No patients found</h3>
                      <p className="text-gray-500">
                        {searchQuery ? `No patients match "${searchQuery}"` : "No patient data is currently available in the system."}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <div className="inline-block min-w-full align-middle">
                        <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
                          <table className="min-w-full divide-y divide-gray-300">
                            <thead className="bg-gray-50">
                              <tr>
                                <th
                                  scope="col"
                                  className="sticky left-0 z-10 bg-gray-50 px-3 py-3.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-300 min-w-[120px]"
                                >
                                  First Name
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-3.5 text-left border-r border-gray-300 text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[120px]"
                                >
                                  Last Name
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-3.5 text-left text-xs font-medium border-r border-gray-300  text-gray-500 uppercase tracking-wider min-w-[100px]"
                                >
                                  DOB
                                </th>
                                <th
                                   scope="col"
                                  className="px-3 py-3.5 text-left text-xs font-medium border-r border-gray-300  text-gray-500 uppercase tracking-wider min-w-[130px]"
                                >
                                  Phone Number
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-3.5 text-left text-xs font-medium border-r border-gray-300 text-gray-500 uppercase tracking-wider min-w-[120px]"
                                >
                                  Treatment
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-3.5 text-left text-xs font-medium border-r border-gray-300 text-gray-500 uppercase tracking-wider min-w-[200px]"
                                >
                                  Post Treatment Notes
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-3.5 text-left text-xs font-medium border-r border-gray-300  text-gray-500 uppercase tracking-wider min-w-[180px]"
                                >
                                  Post Treatment Prescription
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-3.5 text-left text-xs font-medium border-r border-gray-300  text-gray-500 uppercase tracking-wider min-w-[150px]"
                                >
                                  Follow Up Appointment
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-3.5 text-left text-xs font-medium border-r border-gray-300  text-gray-500 uppercase tracking-wider min-w-[120px]"
                                >
                                  Call Status
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-3.5 text-left text-xs font-medium border-r border-gray-300  text-gray-500 uppercase tracking-wider min-w-[200px]"
                                >
                                  Follow Up Notes
                                </th>
                                {/* <th
                                  scope="col"
                                  className="px-3 py-3.5 text-left text-xs font-medium border-r border-gray-300 text-gray-500 uppercase tracking-wider min-w-[130px]"
                                >
                                  Follow Up Date
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-3.5 text-left text-xs  border-r border-gray-300font-medium text-gray-500 uppercase tracking-wider min-w-[140px]"
                                >
                                  Post Follow-up Status
                                </th> */}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                              {filteredPatients.map((patient, idx) => (
                                <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                  {/* First Name - Sticky */}
                                  <td className="sticky left-0 z-10 bg-white hover:bg-gray-50 px-3 py-4 text-sm border-r border-gray-300">
                                    <div className="font-medium text-gray-900 min-w-0">{patient.first_name || "-"}</div>
                                  </td>

                                  {/* Last Name */}
                                  <td className="px-3 py-4 text-sm border-r border-gray-300 ">
                                    <div className="text-gray-900 min-w-0">{patient.last_name || "-"}</div>
                                  </td>

                                  {/* DOB */}
                                  <td className="px-3 py-4 text-sm border-r border-gray-300">
                                    <div className="text-gray-900 min-w-0">{patient.date_of_birth || "-"}</div>
                                  </td>

                                  {/* Phone Number */}
                                  <td className="px-3 py-4 text-sm border-r border-gray-300">
                                    <div className="text-gray-900 min-w-0">{patient.phone_number || "-"}</div>
                                  </td>

                                  {/* Treatment */}
                                  <td className="px-3 py-4 text-sm border-r border-gray-300">
                                    <div className="min-w-0">
                                      {renderCellContent(
                                        patient.treatment,
                                        patient,
                                        "treatment",
                                        "Treatment Information",
                                        20,
                                      )}
                                    </div>
                                  </td>

                                  {/* Post Treatment Notes */}
                                  <td className="px-3 py-4 text-sm border-r border-gray-300">
                                    <div className="min-w-0">
                                      {renderCellContent(
                                        patient.post_treatment_notes,
                                        patient,
                                        "post_treatment_notes",
                                        "Post Treatment Notes",
                                        30,
                                      )}
                                    </div>
                                  </td>

                                  {/* Post Treatment Prescription */}
                                  <td className="px-3 py-4 text-sm border-r border-gray-300">
                                    <div className="min-w-0 ">
                                      {renderCellContent(
                                        patient.post_treatment_prescription,
                                        patient,
                                        "post_treatment_prescription",
                                        "Post Treatment Prescription",
                                        25,
                                      )}
                                    </div>
                                  </td>

                                  {/* Follow Up Appointment */}
                                  <td className="px-3 py-4 text-sm border-r border-gray-300">
                                    <div className="text-gray-900 min-w-0">{patient.follow_up_appointment || "-"}</div>
                                  </td>

                                  {/* Call Status */}
                                  <td className="px-3 py-4 text-sm border-r border-gray-300">
                                    <div className="min-w-0">{getStatusBadge(patient.call_status)}</div>
                                  </td>

                                  {/* Follow Up Notes */}
                                  <td className="px-3 py-4 text-sm border-r border-gray-300">
                                    <div className="min-w-0">
                                      {renderCellContent(
                                        patient.post_ops_follow_up_notes,
                                        patient,
                                        "post_ops_follow_up_notes",
                                        "Follow Up Notes",
                                        30,
                                      )}
                                    </div>
                                  </td>

                                  {/* Follow Up Date */}
                                  {/* <td className="px-3 py-4 text-sm border-r border-gray-300">
                                    <div className="text-gray-900 min-w-0">
                                      {patient.date_for_post_op_follow_up || "-"}
                                    </div>
                                  </td> */}

                                  {/* Post Follow-up Status */}
                                  {/* <td className="px-3 py-4 text-sm border-r border-gray-300">
                                    <div className="min-w-0">{getStatusBadge(patient.post_op_call_status)}</div>
                                  </td> */}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Pagination */}
                      <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 sm:px-6 rounded-b-lg mt-4">
                        <div className="flex flex-1 justify-between sm:hidden">
                          <Button variant="outline" size="sm" className={undefined}>
                            Previous
                          </Button>
                          <Button variant="outline" size="sm" className={undefined}>
                            Next
                          </Button>
                        </div>
                        <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm text-gray-700">
                              Showing <span className="font-medium">1</span> to{" "}
                              <span className="font-medium">{filteredPatients.length}</span> of{" "}
                              <span className="font-medium">{filteredPatients.length}</span> results
                            </p>
                          </div>
                          <div>
                            <nav
                              className="isolate inline-flex -space-x-px rounded-md shadow-sm"
                              aria-label="Pagination"
                            >
                              <Button variant="outline" size="sm" className="rounded-r-none bg-transparent">
                                Previous
                              </Button>
                              <Button variant="outline" size="sm" className="bg-blue-50 text-blue-600 rounded-none">
                                1
                              </Button>
                              <Button variant="outline" size="sm" className="rounded-l-none bg-transparent">
                                Next
                              </Button>
                            </nav>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="batch" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>CSV Batch Upload</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* CSV Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Upload CSV File</label>
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept=".csv"
                      onChange={handleFileChange}
                      className="block w-full text-sm text-gray-500
                           file:mr-4 file:py-2 file:px-4
                           file:rounded-md file:border-0
                           file:text-sm file:font-medium
                           file:bg-blue-50 file:text-blue-700
                           hover:file:bg-blue-100"
                    />

                    <div className="mt-3 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                      <p className="font-medium text-yellow-800 mb-2">CSV Format Requirements:</p>
                      <ul className="list-disc pl-5 text-sm text-yellow-700 space-y-1">
                        <li>Must include a column containing phone numbers (in any format)</li>
                        <li>Optional: Include a column with customer names</li>
                        <li>Any other columns will be passed as metadata to the agent</li>
                      </ul>
                    </div>

                    <div className="flex items-center mt-3">
                      <input
                        type="checkbox"
                        id="hasHeaders"
                        checked={hasHeaders}
                        onChange={(e) => setHasHeaders(e.target.checked)}
                        className="mr-2 rounded border-gray-300"
                      />
                      <label htmlFor="hasHeaders" className="text-sm text-gray-700">
                        First row contains headers
                      </label>
                    </div>
                  </div>

                  {/* CSV Data Preview */}
                  {csvData.length > 0 && (
                    <div>
                      <h3 className="text-lg font-medium mb-3">Preview ({csvData.length} contacts)</h3>
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="overflow-x-auto max-h-80">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                                  First Name
                                </th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                                  Last Name
                                </th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                                  DOB
                                </th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                                  Phone Number
                                </th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                                  Treatment
                                </th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                                  Notes
                                </th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                                  Prescription
                                </th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                                  Follow-up Appt
                                </th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                                  Call Status
                                </th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                                  Follow-up Notes
                                </th>
                                {/* <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                                  Follow-up Date
                                </th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                                  Post Follow-up Status
                                </th> */}
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {csvData.slice(0, 5).map((row, index) => {
                                const isAlreadyCalled = row.metadata?.call_status?.toLowerCase() === "called"
                                const rowClass = isAlreadyCalled 
                                  ? "bg-orange-50 border-l-4 border-orange-400" 
                                  : "hover:bg-gray-50"
                                
                                return (
                                  <tr key={index} className={rowClass}>
                                    <td className="px-3 py-3 text-sm text-gray-900 whitespace-nowrap">
                                      {row.metadata?.first_name || "-"}
                                      {isAlreadyCalled && <span className="ml-1 text-orange-600 text-xs">⚠️</span>}
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-900 whitespace-nowrap">
                                      {row.metadata?.last_name || "-"}
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-900 whitespace-nowrap">
                                      {row.metadata?.date_of_birth || "-"}
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-900 whitespace-nowrap">
                                      {row.phoneNumber || "-"}
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-900 whitespace-nowrap">
                                      {row.metadata?.treatment || "-"}
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-900 max-w-[200px] truncate" title={row.metadata?.post_treatment_notes}>
                                      {row.metadata?.post_treatment_notes || "-"}
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-900 max-w-[150px] truncate" title={row.metadata?.post_treatment_prescription}>
                                      {row.metadata?.post_treatment_prescription || "-"}
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-900 whitespace-nowrap">
                                      {row.metadata?.follow_up_appointment || "-"}
                                    </td>
                                    <td className="px-3 py-3 text-sm whitespace-nowrap">
                                      {isAlreadyCalled ? (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                          Called (Skip)
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                          Will Call
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-900 max-w-[150px] truncate" title={row.metadata?.post_ops_follow_up_notes}>
                                      {row.metadata?.post_ops_follow_up_notes || "-"}
                                    </td>
                                    {/* <td className="px-3 py-3 text-sm text-gray-900 whitespace-nowrap">
                                      {row.metadata?.date_for_post_op_follow_up || "-"}
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-900 whitespace-nowrap">
                                      {row.metadata?.post_op_call_status || "-"}
                                    </td> */}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                        {csvData.length > 5 && (
                          <div className="text-center p-3 text-sm text-gray-500 border-t bg-gray-50">
                            {csvData.length - 5} more records not shown
                          </div>
                        )}
                      </div>

                      <div className="flex justify-end gap-3 mt-4">
                        <Button variant="outline" onClick={cancelCSVImport} className={undefined} size={undefined}>
                          Cancel
                        </Button>
                        <Button onClick={processCsvBatch} disabled={processingBatch} className={undefined} variant={undefined} size={undefined}>
                          {processingBatch ? "Processing..." : `Process ${csvData.length} Calls`}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Modal for viewing full content */}
      <Dialog open={!!modalData} onOpenChange={() => setModalData(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {modalData?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            {modalData && (
              <div className="space-y-6">
                {/* Patient Header */}
                <div className="flex items-center p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg">
                  <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center mr-4">
                    <span className="text-xl font-bold text-blue-700">
                      {modalData.patient.first_name?.[0]}
                      {modalData.patient.last_name?.[0]}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">
                      {modalData.patient.first_name} {modalData.patient.last_name}
                    </h2>
                    <p className="text-gray-600">Patient ID: {modalData.patient.patient_id || "Not assigned"}</p>
                    <p className="text-gray-600">DOB: {modalData.patient.date_of_birth || "Not provided"}</p>
                  </div>
                </div>

                {/* Content */}
                <Card>
                  <CardHeader>
                    <CardTitle>{modalData.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-gray-700 whitespace-pre-wrap">{modalData.content}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AuthenticatedLayout>
  )
}
