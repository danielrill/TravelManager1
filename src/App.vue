<template>
  <div class="container">
    <header>
      <h1>✈️ Trip Manager</h1>
      <p>Plan and manage your leisure travels</p>
    </header>

    <main>
      <TripForm
        :editingTrip="editingTrip"
        @trip-saved="refresh"
        @reset-edit="clearEditing"
      />
      <TripList
        :refreshTrigger="refreshKey"
        @edit-trip="startEdit"
      />
    </main>

    <footer>
      <div class="contact">
        <p><strong>Contact:</strong> Group Members: Alice Johnson, Bob Smith, Charlie Davis</p>
        <p><small>Leisure Travel App - Vue + REST API + SQLite</small></p>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import TripForm from './components/TripForm.vue'
import TripList from './components/TripList.vue'

const refreshKey = ref(0)
const editingTrip = ref(null)

function refresh() {
  refreshKey.value++ // forces TripList to reload
}

function startEdit(trip) {
  editingTrip.value = trip
}

function clearEditing() {
  editingTrip.value = null
}
</script>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background-color: #f0f8ff;
  color: #333;
  line-height: 1.6;
}
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}
header {
  text-align: center;
  margin-bottom: 30px;
}
header h1 {
  color: #2c3e50;
  font-size: 2.5rem;
}
header p {
  color: #7f8c8d;
  font-size: 1.1rem;
}
main {
  display: flex;
  flex-wrap: wrap;
  gap: 30px;
}
main > * {
  flex: 1;
  min-width: 280px;
}
footer {
  margin-top: 40px;
  text-align: center;
  padding: 20px;
  border-top: 1px solid #ddd;
  color: #7f8c8d;
}
</style>
