// Fictional student records for learning and testing. No real marks are used.
export function makeSampleData() {
  const people = [
    ["Amal Perera", "Rahula College, Matara", "Maths", "6900"],
    ["Nethmi Wijesinghe", "Sujatha Vidyalaya, Matara", "Maths", "115677"],
    ["Dinuka Senarath", "Rahula College, Matara", "Maths", "22415"],
    ["Tharushi Fernando", "Sujatha Vidyalaya, Matara", "Bio", "103413"],
    ["Kavindu Silva", "St. Thomas College, Matara", "Bio", "123822"],
    ["Senuli Jayawardena", "Sujatha Vidyalaya, Matara", "Maths", "24425"],
    ["Pasindu Ranasinghe", "Rahula College, Matara", "Maths", "14361"],
    ["Dulani Madushika", "St. Thomas Girls’ School", "Bio", "58853"],
    ["Sahan Bandara", "Rahula College, Matara", "Maths", "63902"],
    ["Hiruni Abeywickrama", "Sujatha Vidyalaya, Matara", "Bio", "64387"],
    ["Vihan Gamage", "St. Servatius College", "Maths", "100570"],
    ["Imasha Dissanayake", "Sujatha Vidyalaya, Matara", "Bio", ""],
  ];
  const students = people.map(([name, school, stream, number], i) => ({
    key: `student-${i}`,
    name,
    school,
    stream,
    year: 2027,
    active: true,
    id: number ? `SC/2027/${number}` : "TEMP/SC/2027/000001",
  }));
  students.push(
    ...people
      .slice(0, 4)
      .map(([name, school, stream], i) => ({
        key: `2028-${i}`,
        name: [
          "Ravindu Dias",
          "Minuli Perera",
          "Dewan Jayasuriya",
          "Hansi Karunaratne",
        ][i],
        school,
        stream,
        year: 2028,
        active: true,
        id: `SC/2028/${85000 + i}`,
      })),
  );
  const users = [
    { key: "sasindu", name: "Sasindu", initials: "SS", admin: true },
    { key: "admin-two", name: "Admin 2", initials: "A2", admin: true },
    { key: "marker-three", name: "Marker 3", initials: "M3", admin: false },
    { key: "marker-four", name: "Marker 4", initials: "M4", admin: false },
    { key: "marker-five", name: "Marker 5", initials: "M5", admin: false },
  ];
  const tests = [
    {
      key: "2027-p6",
      year: 2027,
      phase: "Phase 3",
      paper: "Paper 6",
      max: 150,
      date: "2026-11-07",
      status: "Open",
      participants: users.map((user) => user.key),
    },
    {
      key: "2027-p5",
      year: 2027,
      phase: "Phase 3",
      paper: "Paper 5",
      max: 40,
      date: "2026-10-31",
      status: "Closed",
      participants: users.map((user) => user.key),
    },
    {
      key: "2028-p5",
      year: 2028,
      phase: "Phase 1",
      paper: "Paper 5",
      max: 40,
      date: "2026-11-07",
      status: "Open",
      participants: users.map((user) => user.key),
    },
  ];
  const marks = [114, 100, 87, 81, 78, 76, 76, 75];
  const scores = marks.map((mark, i) => ({
    testId: "2027-p6",
    studentKey: `student-${i}`,
    markerId: i < 4 ? "sasindu" : "marker-three",
    cents: mark * 100,
    source: "Paper",
    updatedAt: "2026-11-07T08:30:00Z",
  }));
  scores.push(
    ...marks
      .slice(0, 6)
      .map((_, i) => ({
        testId: "2027-p5",
        studentKey: `student-${i}`,
        markerId: "sasindu",
        cents: (34 - i * 2) * 100,
        source: "Paper",
        updatedAt: "2026-10-31T08:30:00Z",
      })),
  );
  return {
    schemaVersion: 1,
    users,
    students,
    tests,
    scores,
    submissions: {},
    history: [],
  };
}
